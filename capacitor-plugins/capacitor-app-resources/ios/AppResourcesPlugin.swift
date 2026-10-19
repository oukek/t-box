import Capacitor
import Foundation

@objc(AppResourcesPlugin)
public class AppResourcesPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "AppResourcesPlugin"
  public let jsName = "TBoxAppResources"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "manifest", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "has", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
  ]
  private let jobs = DispatchQueue(label: "tbox.resources.install", attributes: .concurrent)
  private let store = VerifiedPackageStore(
    root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("TBoxApplicationPackages"))
  private var servers: [String: (ResourceLoopbackServer, String)] = [:]
  private var order: [String] = []
  private let lockRegistry = NSLock()
  private var locks: [String: NSLock] = [:]
  private let serverLock = NSLock()
  private func run(
    _ call: CAPPluginCall, _ work: @escaping (String, String) throws -> [String: Any]
  ) {
    jobs.async {
      do {
        let app = call.getString("appId") ?? ""
        let digest = call.getString("digest") ?? ""
        _ = try self.store.directory(app, digest)
        self.lockRegistry.lock()
        let key = "\(app):\(digest)"
        let lock = self.locks[key] ?? NSLock()
        self.locks[key] = lock
        self.lockRegistry.unlock()
        lock.lock()
        defer { lock.unlock() }
        call.resolve(try work(app, digest))
      } catch { call.reject("应用资源下载、校验或本地读取失败", "APP_RESOURCE_FAILED", error) }
    }
  }
  @objc public func has(_ call: CAPPluginCall) {
    run(call) { app, digest in
      if try !self.store.has(app, digest), let resources = Bundle.main.resourceURL {
        let base = resources.appendingPathComponent("tbox-packages").appendingPathComponent(app).appendingPathComponent(digest)
        let manifest = base.appendingPathComponent("tbox-package-files.json")
        if FileManager.default.fileExists(atPath: manifest.path) {
          let data = try Data(contentsOf: manifest)
          guard data.count <= 1024 * 1024, let json = String(data: data, encoding: .utf8) else { throw PackageFailure(message: "Invalid bundled manifest") }
          try self.store.prepareBundled(app, digest, filesJson: json, read: { path in
            let url = base.appendingPathComponent(path)
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= 5 * 1024 * 1024 else { throw PackageFailure(message: "Bundled resource too large") }
            return try Data(contentsOf: url)
          })
        }
      }
      return ["ready": try self.store.has(app, digest)]
    }
  }
  @objc public func manifest(_ call: CAPPluginCall) {
    run(call) { app, digest in
      let base = call.getString("baseUrl") ?? ""
      guard let url = URL(string: base), url.scheme == "https", url.host != nil, url.user == nil,
        url.password == nil, url.query == nil, url.fragment == nil,
        base.hasSuffix("/\(app)/\(digest)/")
      else { throw PackageFailure(message: "Invalid package URL") }
      let data = try ResourceTransfer().read(url.appendingPathComponent("artifact.json"))
      guard data.count <= 1024 * 1024, let content = String(data: data, encoding: .utf8) else {
        throw PackageFailure(message: "Invalid manifest")
      }
      return ["content": content]
    }
  }
  @objc public func prepare(_ call: CAPPluginCall) {
    run(call) { app, digest in
      try self.store.prepare(
        app, digest, base: call.getString("baseUrl") ?? "",
        filesJson: call.getString("filesJson") ?? "",
        download: { url in try ResourceTransfer().read(url) },
        progress: { completed, total, bytes in
          self.notifyListeners(
            "progress",
            data: [
              "appId": app, "digest": digest, "completed": completed, "total": total,
              "bytes": bytes,
            ])
        })
      return [:]
    }
  }
  @objc public func open(_ call: CAPPluginCall) {
    run(call) { app, digest in
      self.serverLock.lock()
      defer { self.serverLock.unlock() }
      let key = "\(app):\(digest)"
      if self.servers[key] == nil {
        let server = try ResourceLoopbackServer(store: self.store, app: app, digest: digest)
        self.servers[key] = (server, try server.start())
      }
      self.order.removeAll { $0 == key }
      self.order.append(key)
      if self.order.count > 8 {
        let oldest = self.order.removeFirst()
        self.servers.removeValue(forKey: oldest)?.0.close()
      }
      return ["entryUrl": self.servers[key]!.1]
    }
  }
  @objc public func remove(_ call: CAPPluginCall) {
    run(call) { app, digest in
      self.serverLock.lock()
      defer { self.serverLock.unlock() }
      let key = "\(app):\(digest)"
      self.servers.removeValue(forKey: key)?.0.close()
      self.order.removeAll { $0 == key }
      try self.store.remove(app, digest)
      return [:]
    }
  }
}
