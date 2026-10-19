package com.tbox.plugins.appresources;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;

/** A different port for every app/version gives every iframe a separate browser origin. */
public final class LoopbackServer implements AutoCloseable {
    private final ServerSocket server;
    private final ExecutorService clients = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8));
    private final String prefix;
    private final PackageStore store;
    private final String appId, digest;
    private final Map<String, String> files;
    public LoopbackServer(PackageStore store, String appId, String digest, Map<String, String> files) throws IOException {
        this.store = store; this.appId = appId; this.digest = digest; this.files = files;
        byte[] random = new byte[24]; new SecureRandom().nextBytes(random);
        prefix = "/" + PackageStore.hex(random) + "/" + digest + "/";
        server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        Thread thread = new Thread(() -> {
            while (!server.isClosed()) {
                try {
                    Socket socket = server.accept();
                    try { clients.execute(() -> serve(socket)); }
                    catch (RejectedExecutionException busy) { socket.close(); }
                } catch (IOException error) { if (!server.isClosed()) close(); }
            }
        }, "TBox application resources");
        thread.setDaemon(true); thread.start();
    }
    public String entryUrl() { return "http://127.0.0.1:" + server.getLocalPort() + prefix; }
    private void serve(Socket socket) {
        try (Socket client = socket) {
            client.setSoTimeout(5000);
            InputStream input = socket.getInputStream(); ByteArrayOutputStream header = new ByteArrayOutputStream(); int value;
            while ((value = input.read()) != -1 && header.size() < 8192) {
                header.write(value);
                if (new String(header.toByteArray(), StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) break;
            }
            String text = new String(header.toByteArray(), StandardCharsets.US_ASCII);
            String[] request = text.split("\r\n", 2)[0].split(" ");
            String host = "host: 127.0.0.1:" + server.getLocalPort();
            if (request.length != 3 || !request[0].equals("GET") || !Arrays.asList(text.toLowerCase(Locale.ROOT).split("\r\n")).contains(host) || !request[1].startsWith(prefix) || header.size() >= 8192) { respond(socket, 404, "text/plain", new byte[0]); return; }
            String path = request[1].substring(prefix.length()).split("\\?", 2)[0];
            if (path.isEmpty()) path = "index.html";
            byte[] bytes = store.read(appId, digest, path, files);
            respond(socket, 200, mime(path), bytes);
        } catch (Exception ignored) { /* Broken or corrupted reads fail closed; the SDK-ready deadline triggers repair/rollback. */ }
    }
    private static void respond(Socket socket, int status, String type, byte[] bytes) throws IOException {
        OutputStream output = socket.getOutputStream();
        output.write(("HTTP/1.1 " + status + (status == 200 ? " OK" : " Not Found") + "\r\nContent-Type: " + type + "\r\nContent-Length: " + bytes.length + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        output.write(bytes); output.flush();
    }
    private static String mime(String path) {
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        return switch (ext) {
            case "html" -> "text/html; charset=utf-8";
            case "js", "mjs" -> "application/javascript";
            case "css" -> "text/css";
            case "json" -> "application/json";
            case "svg" -> "image/svg+xml";
            case "png" -> "image/png";
            case "jpg", "jpeg" -> "image/jpeg";
            case "webp" -> "image/webp";
            case "woff2" -> "font/woff2";
            case "wasm" -> "application/wasm";
            default -> "application/octet-stream";
        };
    }
    @Override public void close() { try { server.close(); } catch (IOException ignored) {} clients.shutdownNow(); }
}
