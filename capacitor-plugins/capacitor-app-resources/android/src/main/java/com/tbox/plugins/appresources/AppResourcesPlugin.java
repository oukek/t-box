package com.tbox.plugins.appresources;

import com.getcapacitor.*;
import android.net.Uri;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

@CapacitorPlugin(name = "TBoxAppResources")
public class AppResourcesPlugin extends Plugin {
    private final ExecutorService jobs = Executors.newFixedThreadPool(3);
    private final LinkedHashMap<String, LoopbackServer> servers = new LinkedHashMap<>(8, .75f, true);
    private final ConcurrentHashMap<String, Object> locks = new ConcurrentHashMap<>();
    private PackageStore store;
    @Override public void load() { store = new PackageStore(new File(getContext().getNoBackupFilesDir(), "application-packages")); }
    private Map<String, String> files(String json) throws Exception {
        JSONObject object = new JSONObject(json); Map<String, String> values = new LinkedHashMap<>();
        var keys = object.keys(); while (keys.hasNext()) { String key = keys.next(); Object value = object.get(key); if (!(value instanceof String)) throw new IllegalArgumentException("Invalid manifest"); values.put(key, (String) value); }
        return values;
    }
    private void run(PluginCall call, Work work) {
        jobs.execute(() -> {
            try { String app = call.getString("appId", ""), digest = call.getString("digest", ""); PackageStore.key(app, digest); synchronized (locks.computeIfAbsent(app + ":" + digest, key -> new Object())) { work.run(app, digest); } }
            catch (Exception error) { call.reject("应用资源下载、校验或本地读取失败", "APP_RESOURCE_FAILED", error); }
        });
    }
    private interface Work { void run(String app, String digest) throws Exception; }
    private byte[] bundled(String path) throws Exception {
        try (java.io.InputStream input = getContext().getAssets().open("tbox-packages/" + path); java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] bytes = new byte[16384]; int count;
            while ((count = input.read(bytes)) != -1) { if (output.size() + count > 5 * 1024 * 1024) throw new java.io.IOException("Bundled resource too large"); output.write(bytes, 0, count); }
            return output.toByteArray();
        }
    }
    @PluginMethod public void has(PluginCall call) { run(call, (app, digest) -> {
        if (!store.has(app, digest)) {
            String prefix = app + "/" + digest + "/";
            byte[] manifest = null;
            try { manifest = bundled(prefix + "tbox-package-files.json"); } catch (java.io.FileNotFoundException absent) { /* Not shipped with this binary. */ }
            if (manifest != null) {
                String json = new String(manifest, StandardCharsets.UTF_8);
                if (manifest.length > 1024 * 1024) throw new IllegalArgumentException("Manifest too large");
                store.prepareBundled(app, digest, json, files(json), path -> bundled(prefix + path));
            }
        }
        JSObject result = new JSObject(); result.put("ready", store.has(app, digest)); call.resolve(result);
    }); }
    @PluginMethod public void manifest(PluginCall call) { run(call, (app, digest) -> {
        java.net.URI base = java.net.URI.create(call.getString("baseUrl", ""));
        if (!"https".equals(base.getScheme()) || base.getHost() == null || base.getUserInfo() != null || base.getQuery() != null || base.getFragment() != null || !base.getPath().endsWith("/" + app + "/" + digest + "/")) throw new IllegalArgumentException("Invalid package URL");
        byte[] data = PackageStore.download(base.resolve("artifact.json").toURL());
        if (data.length > 1024 * 1024) throw new IllegalArgumentException("Manifest too large");
        JSObject result = new JSObject(); result.put("content", new String(data, StandardCharsets.UTF_8)); call.resolve(result);
    }); }
    @PluginMethod public void prepare(PluginCall call) { run(call, (app, digest) -> {
        String json = call.getString("filesJson", ""); if (json.length() > 1024 * 1024) throw new IllegalArgumentException("Manifest too large");
        store.prepare(app, digest, call.getString("baseUrl", ""), json, files(json), PackageStore::download, (completed, total, bytes) -> {
            JSObject progress = new JSObject(); progress.put("appId", app); progress.put("digest", digest); progress.put("completed", completed); progress.put("total", total); progress.put("bytes", bytes); notifyListeners("progress", progress);
        }); call.resolve();
    }); }
    @PluginMethod public void open(PluginCall call) { run(call, (app, digest) -> {
        if (!store.has(app, digest)) throw new IllegalStateException("Package not ready");
        synchronized (servers) {
        String key = app + ":" + digest; LoopbackServer server = servers.get(key);
        if (server == null) {
            server = new LoopbackServer(store, app, digest, files(new String(PackageStore.readFile(new File(store.directory(app, digest), ".ready")), StandardCharsets.UTF_8))); servers.put(key, server);
            if (servers.size() > 8) { String oldest = servers.keySet().iterator().next(); servers.remove(oldest).close(); }
        }
        JSObject result = new JSObject(); result.put("entryUrl", server.entryUrl()); call.resolve(result);
        }
    }); }
    @PluginMethod public void remove(PluginCall call) { run(call, (app, digest) -> { synchronized (servers) { LoopbackServer server = servers.remove(app + ":" + digest); if (server != null) server.close(); store.remove(app, digest); call.resolve(); } }); }
    @Override public Boolean shouldOverrideLoad(Uri url) {
        // Native dev deliberately follows Capacitor's configured live-reload origin policy.
        if (getBridge().getServerUrl() != null) return null;
        if (!"http".equals(url.getScheme()) || !"127.0.0.1".equals(url.getHost())) return null;
        // Keep native-bridge origin rules unchanged. Allow only plugin-owned package URLs.
        synchronized (servers) {
            for (LoopbackServer server : servers.values()) {
                if (url.toString().startsWith(server.entryUrl())) return false;
            }
        }
        return true;
    }
    @Override protected void handleOnDestroy() { jobs.shutdownNow(); synchronized (servers) { for (LoopbackServer server : servers.values()) server.close(); servers.clear(); } }
}
