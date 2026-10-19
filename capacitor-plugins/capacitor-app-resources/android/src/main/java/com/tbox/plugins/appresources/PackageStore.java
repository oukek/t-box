package com.tbox.plugins.appresources;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** No Android dependency: atomic verified package storage, independently testable on the JVM. */
public final class PackageStore {
    public interface Downloader { byte[] read(URL url) throws Exception; }
    public interface Progress { void update(int completed, int total, long bytes); }
    public interface BundledReader { byte[] read(String path) throws Exception; }
    private final File root;
    public PackageStore(File root) { this.root = root; }
    public static String sha(byte[] bytes) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
    public static String hex(byte[] bytes) { StringBuilder out = new StringBuilder(); for (byte value : bytes) out.append(String.format(Locale.ROOT, "%02x", value & 255)); return out.toString(); }
    public static void key(String appId, String digest) {
        if (!appId.matches("[a-z][\\w-]{0,63}") || !digest.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid package key");
    }
    public static boolean path(String path) {
        if (path.length() > 240 || !path.matches("[\\w./@-]+") || path.equals("artifact.json")) return false;
        return Arrays.stream(path.split("/", -1)).noneMatch(p -> p.isEmpty() || p.equals(".") || p.equals(".."));
    }
    public File directory(String appId, String digest) { key(appId, digest); return new File(new File(root, appId), digest); }
    public boolean has(String appId, String digest) {
        return new File(directory(appId, digest), ".ready").isFile();
    }
    /** Signed APK assets use the same verifier and atomic activation, with no network downloader. */
    public void prepareBundled(String app, String digest, String json, Map<String, String> files, BundledReader reader) throws Exception {
        String prefix = "/" + app + "/" + digest + "/";
        prepare(app, digest, "https://bundled.tbox.invalid" + prefix, json, files, url -> reader.read(url.getPath().substring(prefix.length())), (a,b,c) -> {});
    }
    public void prepare(String appId, String digest, String base, String filesJson, Map<String, String> files, Downloader downloader, Progress progress) throws Exception {
        key(appId, digest);
        URI uri = URI.create(base);
        if (!uri.getScheme().equals("https") || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || !uri.getPath().endsWith("/" + appId + "/" + digest + "/") ||
                !sha(filesJson.getBytes(StandardCharsets.UTF_8)).equals(digest) || files.isEmpty() || files.size() > 2000 || !files.containsKey("index.html") ||
                files.entrySet().stream().anyMatch(e -> !path(e.getKey()) || !e.getValue().matches("[a-f0-9]{64}"))) throw new IOException("Invalid package manifest");
        if (has(appId, digest)) return;
        File parent = directory(appId, digest).getParentFile();
        if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create package directory");
        File staging = new File(parent, ".staging-" + digest + "-" + UUID.randomUUID());
        File[] abandoned = parent.listFiles((folder, name) -> name.startsWith(".staging-" + digest + "-"));
        if (abandoned != null) for (File old : abandoned) delete(old);
        if (!staging.mkdir()) throw new IOException("Cannot create staging directory");
        try {
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(120);
            long total = 0; int done = 0;
            for (Map.Entry<String, String> file : files.entrySet()) {
                if (Thread.currentThread().isInterrupted() || System.nanoTime() > deadline) throw new IOException("Package preparation cancelled or timed out");
                byte[] bytes = downloader.read(uri.resolve(file.getKey()).toURL());
                total += bytes.length;
                if (bytes.length > 5 * 1024 * 1024 || total > 20 * 1024 * 1024 || !sha(bytes).equals(file.getValue())) throw new IOException("Application resource integrity mismatch");
                File target = new File(staging, file.getKey());
                if (!target.getParentFile().isDirectory() && !target.getParentFile().mkdirs()) throw new IOException("Cannot create package directory");
                write(target, bytes);
                progress.update(++done, files.size(), total);
            }
            write(new File(staging, ".ready"), filesJson.getBytes(StandardCharsets.UTF_8));
            File destination = directory(appId, digest);
            if (destination.exists()) delete(destination);
            if (!staging.renameTo(destination)) throw new IOException("Atomic package activation failed");
        } finally { if (staging.exists()) delete(staging); }
    }
    public byte[] read(String appId, String digest, String path, Map<String, String> files) throws Exception {
        if (!has(appId, digest) || !path(path) || !files.containsKey(path)) throw new FileNotFoundException();
        byte[] bytes = readFile(new File(directory(appId, digest), path));
        if (!sha(bytes).equals(files.get(path))) throw new IOException("Local application resource corrupted");
        return bytes;
    }
    public void remove(String appId, String digest) throws IOException { File path = directory(appId, digest); if (path.exists()) delete(path); }
    public static void delete(File path) throws IOException {
        File[] entries = path.listFiles();
        if (entries != null) for (File entry : entries) delete(entry);
        if (!path.delete()) throw new IOException("Cannot remove package resource");
    }
    public static byte[] readFile(File path) throws IOException {
        if (path.length() > 5 * 1024 * 1024) throw new IOException("Resource too large");
        try (InputStream input = new FileInputStream(path); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384]; int count;
            while ((count = input.read(buffer)) != -1) { if (output.size() + count > 5 * 1024 * 1024) throw new IOException("Resource too large"); output.write(buffer, 0, count); }
            return output.toByteArray();
        }
    }
    private static void write(File path, byte[] bytes) throws IOException { try (FileOutputStream output = new FileOutputStream(path)) { output.write(bytes); output.getFD().sync(); } }
    public static byte[] download(URL url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("Cookie", "");
        connection.setUseCaches(false);
        try {
            if (connection.getResponseCode() != 200 || connection.getContentLengthLong() > 5 * 1024 * 1024) throw new IOException("Application resource download failed");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[16384]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 5 * 1024 * 1024) throw new IOException("Application resource too large");
                    bytes.write(buffer, 0, count);
                }
                return bytes.toByteArray();
            }
        } finally { connection.disconnect(); }
    }
}
