import Foundation
import Network
import Security

/// A private loopback listener per app/version preserves origin isolation from the Capacitor host.
final class ResourceLoopbackServer {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "tbox.resources.http")
  private let store: VerifiedPackageStore
  private let app: String
  private let digest: String
  private let files: [String: String]
  private let prefix: String
  private var clients = 0
  init(store: VerifiedPackageStore, app: String, digest: String) throws {
    self.store = store
    self.app = app
    self.digest = digest
    files = try store.manifest(app, digest)
    var bytes = [UInt8](repeating: 0, count: 24)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw PackageFailure(message: "Random generation failed")
    }
    prefix = "/\(bytes.map { String(format: "%02x", $0) }.joined())/\(digest)/"
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
  }
  func start() throws -> String {
    let ready = DispatchSemaphore(value: 0)
    var failure: Error?
    listener.stateUpdateHandler = { state in
      switch state {
      case .ready: ready.signal()
      case .failed(let error):
        failure = error
        ready.signal()
      default: break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      guard let self = self, self.clients < 8 else {
        connection.cancel()
        return
      }
      self.clients += 1
      connection.start(queue: self.queue)
      self.receive(connection, accumulated: Data())
    }
    listener.start(queue: queue)
    guard ready.wait(timeout: .now() + 5) == .success, let port = listener.port, failure == nil
    else {
      listener.cancel()
      throw PackageFailure(message: "Local application server failed")
    }
    return "http://127.0.0.1:\(port.rawValue)\(prefix)"
  }
  private func finish(_ connection: NWConnection) {
    clients -= 1
    connection.cancel()
  }
  private func receive(_ connection: NWConnection, accumulated: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) {
      [weak self] bytes, _, complete, error in
      guard let self = self else {
        connection.cancel()
        return
      }
      var header = accumulated
      if let bytes = bytes { header.append(bytes) }
      guard error == nil, header.count < 8192 else {
        self.finish(connection)
        return
      }
      guard let text = String(data: header, encoding: .ascii), text.contains("\r\n\r\n") else {
        if complete {
          self.finish(connection)
        } else {
          self.receive(connection, accumulated: header)
        }
        return
      }
      let fields = text.components(separatedBy: "\r\n").first?.components(separatedBy: " ") ?? []
      let expectedHost = "host: 127.0.0.1:\(self.listener.port!.rawValue)"
      var body = Data()
      var type = "text/plain"
      var status = "404 Not Found"
      if fields.count == 3, fields[0] == "GET", fields[1].hasPrefix(self.prefix),
        text.lowercased().components(separatedBy: "\r\n").contains(expectedHost)
      {
        let raw = String(fields[1].dropFirst(self.prefix.count)).components(separatedBy: "?")[0]
        let path = raw.isEmpty ? "index.html" : raw
        if let data = try? self.store.read(self.app, self.digest, path: path, files: self.files) {
          body = data
          type = Self.mime(path)
          status = "200 OK"
        }
      }
      let response =
        "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
      var data = Data(response.utf8)
      data.append(body)
      connection.send(content: data, completion: .contentProcessed { _ in self.finish(connection) })
    }
    // Local clients cannot hold a listener slot indefinitely with an unfinished request.
    queue.asyncAfter(deadline: .now() + 5) { connection.cancel() }
  }
  private static func mime(_ path: String) -> String {
    switch URL(fileURLWithPath: path).pathExtension.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "application/javascript"
    case "css": return "text/css"
    case "json": return "application/json"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "woff2": return "font/woff2"
    case "wasm": return "application/wasm"
    default: return "application/octet-stream"
    }
  }
  func close() { listener.cancel() }
  deinit { listener.cancel() }
}
