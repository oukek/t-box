import Foundation

@main struct PackageStoreTest {
  static func check(_ condition: Bool) { precondition(condition) }
  static func main() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = VerifiedPackageStore(root: root)
    let page = Data("<html>offline</html>".utf8)
    let hash = VerifiedPackageStore.sha(page)
    let json = "{\"index.html\":\"\(hash)\"}"
    let digest = VerifiedPackageStore.sha(Data(json.utf8))
    var count = 0
    try store.prepare(
      "notes", digest, base: "https://apps.test/notes/\(digest)/", filesJson: json,
      download: { _ in
        count += 1
        return page
      }, progress: { done, total, bytes in check(done == total && bytes == page.count) })
    check(try store.has("notes", digest))
    check(count == 1)
    try store.prepare(
      "notes", digest, base: "https://apps.test/notes/\(digest)/", filesJson: json,
      download: { _ in throw PackageFailure(message: "offline") }, progress: { _, _, _ in })
    var bundledReads = 0
    try store.prepareBundled("shipped", digest, filesJson: json, read: { path in
      check(path == "index.html")
      bundledReads += 1
      return page
    })
    check(bundledReads == 1)
    check(try store.has("shipped", digest))
    try store.prepareBundled("shipped", digest, filesJson: json, read: { _ in throw PackageFailure(message: "offline, no asset read") })
    try store.remove("shipped", digest)
    try store.prepareBundled("shipped", digest, filesJson: json, read: { _ in page })
    check(try store.has("shipped", digest))
    let server = try ResourceLoopbackServer(store: store, app: "notes", digest: digest)
    defer { server.close() }
    let entry = try server.start()
    let done = DispatchSemaphore(value: 0)
    var received = false
    URLSession.shared.dataTask(with: URL(string: entry)!) { data, response, _ in
      received = data == page && (response as? HTTPURLResponse)?.statusCode == 200
      done.signal()
    }.resume()
    check(done.wait(timeout: .now() + 10) == .success)
    check(received)
    let nextJson = "{\"index.html\":\"\(VerifiedPackageStore.sha(Data("next".utf8)))\"}"
    let next = VerifiedPackageStore.sha(Data(nextJson.utf8))
    do {
      try store.prepare(
        "notes", next, base: "https://apps.test/notes/\(next)/", filesJson: nextJson,
        download: { _ in page }, progress: { _, _, _ in })
      preconditionFailure("corruption accepted")
    } catch {
      check(try store.has("notes", digest))
      check(try !store.has("notes", next))
    }
    for path in ["../secret", "/absolute", "a//b", "a/%2e%2e/b", "a\\b", "a\n"] {
      check(!VerifiedPackageStore.validPath(path))
    }
    try Data("tampered".utf8).write(
      to: store.directory("notes", digest).appendingPathComponent("index.html"))
    do {
      _ = try store.read("notes", digest, path: "index.html", files: ["index.html": hash])
      preconditionFailure("local corruption accepted")
    } catch {}
    try store.remove("notes", digest)
    check(try !store.has("notes", digest))
    print("Native package integrity, offline loopback launch, atomic failure and repair passed")
  }
}
