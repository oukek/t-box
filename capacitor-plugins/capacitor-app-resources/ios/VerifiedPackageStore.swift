import CryptoKit
import Foundation

struct PackageFailure: Error { let message: String }

/// Files contain only published static resources. No access token or SDK/business data is persisted here.
final class VerifiedPackageStore {
  let root: URL
  init(root: URL) { self.root = root }
  static func sha(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
  static func valid(_ value: String, _ expression: String) -> Bool {
    value.range(of: expression, options: .regularExpression) == value.startIndex..<value.endIndex
  }
  static func validPath(_ value: String) -> Bool {
    value.count <= 240 && valid(value, "^[A-Za-z0-9_./@-]+$") && value != "artifact.json"
      && value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy {
        !$0.isEmpty && $0 != "." && $0 != ".."
      }
  }
  func directory(_ app: String, _ digest: String) throws -> URL {
    guard Self.valid(app, "^[a-z][A-Za-z0-9_-]{0,63}$"), Self.valid(digest, "^[a-f0-9]{64}$") else {
      throw PackageFailure(message: "Invalid package key")
    }
    return root.appendingPathComponent(app).appendingPathComponent(digest, isDirectory: true)
  }
  func has(_ app: String, _ digest: String) throws -> Bool {
    FileManager.default.fileExists(
      atPath: try directory(app, digest).appendingPathComponent(".ready").path)
  }
  /// Signed application resources share the download verifier but never create a network request.
  func prepareBundled(_ app: String, _ digest: String, filesJson: String, read: (String) throws -> Data) throws {
    let prefix = "/\(app)/\(digest)/"
    try prepare(app, digest, base: "https://bundled.tbox.invalid" + prefix, filesJson: filesJson,
      download: { url in try read(String(url.path.dropFirst(prefix.count))) }, progress: { _, _, _ in })
  }
  func manifest(_ app: String, _ digest: String) throws -> [String: String] {
    let bytes = try Data(contentsOf: directory(app, digest).appendingPathComponent(".ready"))
    guard bytes.count <= 1024 * 1024, Self.sha(bytes) == digest,
      let files = try JSONSerialization.jsonObject(with: bytes) as? [String: String]
    else { throw PackageFailure(message: "Invalid local manifest") }
    return files
  }
  func prepare(
    _ app: String, _ digest: String, base: String, filesJson: String,
    download: (URL) throws -> Data, progress: (Int, Int, Int) -> Void
  ) throws {
    let destination = try directory(app, digest)
    guard let url = URL(string: base), url.scheme == "https", url.host != nil, url.user == nil,
      url.password == nil, url.query == nil, url.fragment == nil,
      base.hasSuffix("/\(app)/\(digest)/"),
      let bytes = filesJson.data(using: .utf8), bytes.count <= 1024 * 1024,
      Self.sha(bytes) == digest,
      let files = try JSONSerialization.jsonObject(with: bytes) as? [String: String],
      !files.isEmpty, files.count <= 2000, files["index.html"] != nil,
      files.allSatisfy({ Self.validPath($0.key) && Self.valid($0.value, "^[a-f0-9]{64}$") })
    else { throw PackageFailure(message: "Invalid package manifest") }
    if try has(app, digest) { return }
    let parent = destination.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    for abandoned in try FileManager.default.contentsOfDirectory(
      at: parent, includingPropertiesForKeys: nil)
    where abandoned.lastPathComponent.hasPrefix(".staging-\(digest)-") {
      try? FileManager.default.removeItem(at: abandoned)
    }
    let staging = parent.appendingPathComponent(".staging-\(digest)-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: staging) }
    let deadline = Date().addingTimeInterval(120)
    var total = 0
    var completed = 0
    for (path, hash) in files.sorted(by: { $0.key < $1.key }) {
      guard Date() < deadline else {
        throw PackageFailure(message: "Package preparation timed out")
      }
      let data = try download(url.appendingPathComponent(path))
      total += data.count
      guard data.count <= 5 * 1024 * 1024, total <= 20 * 1024 * 1024, Self.sha(data) == hash else {
        throw PackageFailure(message: "Resource integrity mismatch")
      }
      let target = staging.appendingPathComponent(path)
      try FileManager.default.createDirectory(
        at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: target, options: .atomic)
      completed += 1
      progress(completed, files.count, total)
    }
    try bytes.write(to: staging.appendingPathComponent(".ready"), options: .atomic)
    if FileManager.default.fileExists(atPath: destination.path) {
      try FileManager.default.removeItem(at: destination)
    }
    try FileManager.default.moveItem(at: staging, to: destination)
    var excluded = destination
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try excluded.setResourceValues(values)
  }
  func read(_ app: String, _ digest: String, path: String, files: [String: String]) throws -> Data {
    guard Self.validPath(path), let hash = files[path] else {
      throw PackageFailure(message: "Unknown resource")
    }
    let data = try Data(contentsOf: directory(app, digest).appendingPathComponent(path))
    guard data.count <= 5 * 1024 * 1024, Self.sha(data) == hash else {
      throw PackageFailure(message: "Local resource corrupted")
    }
    return data
  }
  func remove(_ app: String, _ digest: String) throws {
    let url = try directory(app, digest)
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }
}

/// Bounded, cookie-free HTTPS transfers. Redirects are rejected rather than trusting a changed artifact origin.
final class ResourceTransfer: NSObject, URLSessionDataDelegate {
  private var bytes = Data()
  private var failure: Error?
  private let done = DispatchSemaphore(value: 0)
  func read(_ url: URL) throws -> Data {
    let config = URLSessionConfiguration.ephemeral
    config.urlCache = nil
    config.httpShouldSetCookies = false
    config.httpCookieStorage = nil
    config.urlCredentialStorage = nil
    config.timeoutIntervalForRequest = 30
    config.timeoutIntervalForResource = 35
    let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    session.dataTask(with: url).resume()
    guard done.wait(timeout: .now() + 40) == .success else {
      throw PackageFailure(message: "Resource download timed out")
    }
    if let failure = failure { throw failure }
    return bytes
  }
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      response.expectedContentLength <= 5 * 1024 * 1024
    else {
      failure = PackageFailure(message: "Resource unavailable")
      completionHandler(.cancel)
      return
    }
    completionHandler(.allow)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    if bytes.count + data.count > 5 * 1024 * 1024 {
      failure = PackageFailure(message: "Resource too large")
      dataTask.cancel()
    } else {
      bytes.append(data)
    }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    failure = failure ?? error
    done.signal()
  }
}
