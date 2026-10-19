package com.tbox.plugins.appresources;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

public final class PackageStoreTest {
    private static void check(boolean condition) { if (!condition) throw new AssertionError(); }
    public static void main(String[] args) throws Exception {
        File root = Files.createTempDirectory("tbox-resources-").toFile();
        try {
            PackageStore store = new PackageStore(root);
            byte[] page = "<html>offline</html>".getBytes(StandardCharsets.UTF_8);
            String hash = PackageStore.sha(page);
            String json = "{\"index.html\":\"" + hash + "\"}";
            String digest = PackageStore.sha(json.getBytes(StandardCharsets.UTF_8));
            Map<String, String> files = Map.of("index.html", hash);
            int[] bundledReads = {0};
            store.prepareBundled("shipped", digest, json, files, path -> { check(path.equals("index.html")); bundledReads[0]++; return page; });
            check(store.has("shipped", digest) && bundledReads[0] == 1);
            store.prepareBundled("shipped", digest, json, files, path -> { throw new IOException("No network or asset read allowed after import"); });
            check(Arrays.equals(store.read("shipped", digest, "index.html", files), page));
            store.remove("shipped", digest);
            store.prepareBundled("shipped", digest, json, files, path -> page);
            check(store.has("shipped", digest));
            int[] calls = {0};
            store.prepare("notes", digest, "https://apps.test/notes/" + digest + "/", json, files, url -> { calls[0]++; return page; }, (done, total, bytes) -> check(done == total && bytes == page.length));
            check(store.has("notes", digest) && calls[0] == 1);
            store.prepare("notes", digest, "https://apps.test/notes/" + digest + "/", json, files, url -> { throw new IOException("offline"); }, (a,b,c) -> {});
            try (LoopbackServer server = new LoopbackServer(store, "notes", digest, files)) {
                HttpURLConnection connection = (HttpURLConnection) new URL(server.entryUrl()).openConnection();
                check(connection.getResponseCode() == 200);
                check(new String(connection.getInputStream().readAllBytes(), StandardCharsets.UTF_8).equals(new String(page, StandardCharsets.UTF_8)));
                HttpURLConnection foreign = (HttpURLConnection) new URL(new URL(server.entryUrl()), "/index.html").openConnection();
                check(foreign.getResponseCode() == 404);
                check(foreign.getHeaderField("Access-Control-Allow-Origin") == null);
            }
            String nextJson = "{\"index.html\":\"" + PackageStore.sha("next".getBytes()) + "\"}";
            String next = PackageStore.sha(nextJson.getBytes(StandardCharsets.UTF_8));
            try {
                store.prepare("notes", next, "https://apps.test/notes/" + next + "/", nextJson, Map.of("index.html", PackageStore.sha("next".getBytes())), url -> page, (a,b,c) -> {});
                throw new AssertionError("corruption accepted");
            } catch (IOException expected) { check(store.has("notes", digest) && !store.has("notes", next)); }
            check(Arrays.stream(root.listFiles()[0].list()).noneMatch(name -> name.startsWith(".staging-")));
            for (String path : List.of("../secret", "/absolute", "a//b", "a/%2e%2e/b", "a\\b", "a\n")) check(!PackageStore.path(path));
            Files.write(new File(store.directory("notes", digest), "index.html").toPath(), "tampered".getBytes());
            try { store.read("notes", digest, "index.html", files); throw new AssertionError("local corruption accepted"); } catch (IOException expected) {}
            store.remove("notes", digest); check(!store.has("notes", digest));
            System.out.println("Native package integrity, offline launch, origin isolation, atomic failure and repair passed");
        } finally { PackageStore.delete(root); }
    }
}
