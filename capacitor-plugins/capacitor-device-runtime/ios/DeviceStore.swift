import CryptoKit
import Foundation
import Security

public struct DeviceRuntimeFailure: LocalizedError {
  public let code: String
  public let message: String
  public var errorDescription: String? { message }
  public init(_ code: String, _ message: String) { self.code = code; self.message = message }
}
public struct DeviceApplication: Codable, Sendable {
  public let appId: String
  public let name: String
  public let guest: Bool
}
public struct DeviceOpenRequest: Codable, Sendable {
  public let id: String
  public let appId: String
  public let params: [String: String]
  public let createdAt: Double
  public let subject: String?
}
private struct DeviceReceipt: Codable {
  var fingerprint: String
  var result: Data?
  var createdAt: Double
}
private struct DeviceState: Codable {
  var applications: [DeviceApplication] = []
  var grants: [String: [String]] = [:]
  var requests: [DeviceOpenRequest] = []
  var receipts: [String: DeviceReceipt] = [:]
}

/** Shared with App Intents in the main app; no WebView or Capacitor dependency. */
public final class DeviceRuntimeStore: @unchecked Sendable {
  public static let shared = DeviceRuntimeStore()
  let lock = NSRecursiveLock()
  private let file: URL
  private var state: DeviceState
  private let service: String
  private var storageFailed = false
  public init(directory suppliedDirectory: URL? = nil, keychainService: String = "com.tbox.app.native-session") {
    service = keychainService
    let directory = suppliedDirectory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("TBoxDevice", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    #if os(iOS)
    try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: directory.path)
    #endif
    file = directory.appendingPathComponent("runtime.json")
    let restored = try? JSONDecoder().decode(DeviceState.self, from: Data(contentsOf: file))
    state = restored ?? DeviceState()
    storageFailed = FileManager.default.fileExists(atPath: file.path) && restored == nil
    if state.applications.isEmpty,
      let index = Bundle.main.url(forResource: "tbox-bundled-applications", withExtension: "json", subdirectory: "public"),
      let data = try? Data(contentsOf: index), let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let releases = json["applications"] as? [[String: Any]] {
      state.applications = releases.compactMap { release in
        guard let id = release["appId"] as? String, Self.validAppId(id), let manifest = release["manifest"] as? [String: Any], let name = manifest["name"] as? String else { return nil }
        return DeviceApplication(appId: id, name: name, guest: release["guestAccess"] as? String == "local")
      }
    }
  }
  private func save() throws {
    guard !storageFailed else { throw DeviceRuntimeFailure("DEVICE_RESULT_UNKNOWN", "本机操作记录损坏，已停止写入，请先核对数据") }
    let data = try JSONEncoder().encode(state)
    try data.write(to: file, options: [.atomic])
  }
  public func applications() -> [DeviceApplication] {
    lock.lock(); defer { lock.unlock() }
    return state.applications
  }
  public func configure(_ applications: [DeviceApplication]) throws {
    lock.lock(); defer { lock.unlock() }
    guard applications.count <= 256, Set(applications.map(\.appId)).count == applications.count,
      applications.allSatisfy({ Self.validAppId($0.appId) && !$0.name.isEmpty && $0.name.count <= 100 }) else {
      throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "应用列表无效")
    }
    state.applications = applications
    try save()
  }
  public static func validAppId(_ id: String) -> Bool {
    id.range(of: "^[a-z][a-z0-9_-]{0,63}$", options: .regularExpression) != nil
  }
  public func permissions(_ scope: String) -> [String] {
    lock.lock(); defer { lock.unlock() }
    return state.grants[scope] ?? []
  }
  public func changeGrant(_ scope: String, _ capabilities: [String], allow: Bool) throws {
    lock.lock(); defer { lock.unlock() }
    guard scope.count <= 200, !scope.isEmpty else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "设备权限范围无效") }
    var current = Set(state.grants[scope] ?? [])
    if allow { current.formUnion(capabilities) } else { current.subtract(capabilities) }
    state.grants[scope] = current.sorted()
    try save()
  }
  @discardableResult public func enqueue(appId: String, params: [String: String] = [:]) throws -> String {
    lock.lock(); defer { lock.unlock() }
    guard state.applications.contains(where: { $0.appId == appId }), params.count <= 20,
      params.allSatisfy({ $0.key.count <= 40 && $0.value.count <= 2000 && $0.key.range(of: "^\\w+$", options: .regularExpression) != nil }) else {
      throw DeviceRuntimeFailure("APP_NOT_INSTALLED", "应用尚未安装或参数无效，请先打开 T方舟")
    }
    state.requests.removeAll { Date().timeIntervalSince1970 * 1000 - $0.createdAt > 86400_000 }
    guard state.requests.count < 32 else { throw DeviceRuntimeFailure("DEVICE_BUSY", "待处理的快捷指令过多，请先打开应用处理") }
    let id = UUID().uuidString
    state.requests.append(DeviceOpenRequest(id: id, appId: appId, params: params, createdAt: Date().timeIntervalSince1970 * 1000, subject: session()?["subject"]))
    try save()
    NotificationCenter.default.post(name: NSNotification.Name("TBoxOpenRequest"), object: nil)
    return id
  }
  public func pending() -> [DeviceOpenRequest] {
    lock.lock(); defer { lock.unlock() }
    return state.requests.filter { Date().timeIntervalSince1970 * 1000 - $0.createdAt < 86400_000 }
  }
  public func acknowledge(_ id: String) throws {
    lock.lock(); defer { lock.unlock() }
    state.requests.removeAll { $0.id == id }
    try save()
  }
  /** A persisted pending receipt is an uncertain external effect after a process crash. */
  public func begin(scope: String, requestId: String, capability: String, arguments: [String: Any]) throws -> [String: Any]? {
    lock.lock(); defer { lock.unlock() }
    guard requestId.range(of: "^[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "设备请求标识无效") }
    guard !storageFailed else { throw DeviceRuntimeFailure("DEVICE_RESULT_UNKNOWN", "本机操作记录损坏，已停止写入") }
    let payload = try JSONSerialization.data(withJSONObject: ["capability": capability, "arguments": arguments], options: [.sortedKeys])
    let fingerprint = SHA256.hash(data: payload).map { String(format: "%02x", $0) }.joined()
    let key = scope + ":" + requestId
    if let old = state.receipts[key] {
      guard old.fingerprint == fingerprint else { throw DeviceRuntimeFailure("DEVICE_REQUEST_CONFLICT", "同一请求标识不能用于不同操作") }
      guard let data = old.result, let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw DeviceRuntimeFailure("DEVICE_RESULT_UNKNOWN", "设备操作结果待核对，请勿重复提交") }
      return result
    }
    state.receipts = state.receipts.filter { $0.value.result == nil || Date().timeIntervalSince1970 - $0.value.createdAt < 7 * 86400 }
    // Keep unresolved receipts, never evict them to silently permit a repeated external write.
    guard state.receipts.count < 2000 else { throw DeviceRuntimeFailure("DEVICE_BUSY", "设备操作记录过多，请先核对已有操作结果") }
    state.receipts[key] = DeviceReceipt(fingerprint: fingerprint, result: nil, createdAt: Date().timeIntervalSince1970)
    try save()
    return nil
  }
  public func complete(scope: String, requestId: String, result: [String: Any]) throws {
    lock.lock(); defer { lock.unlock() }
    let key = scope + ":" + requestId
    guard var receipt = state.receipts[key] else { return }
    receipt.result = try JSONSerialization.data(withJSONObject: result)
    state.receipts[key] = receipt
    try save()
  }
  public func discard(scope: String, requestId: String) throws {
    lock.lock(); defer { lock.unlock() }
    state.receipts.removeValue(forKey: scope + ":" + requestId)
    try save()
  }
  public func setSession(token: String, apiBase: String, subject: String) throws {
    guard token.range(of: "^n1_[a-f0-9]{64}_[a-f0-9]{64}$", options: .regularExpression) != nil,
      let url = URL(string: apiBase), url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else {
      throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "原生会话配置无效")
    }
    var allowed = url.scheme == "https"
    #if DEBUG
    if url.scheme == "http" { allowed = true }
    #endif
    guard allowed else {
      throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "原生会话配置无效；正式服务需使用 HTTPS")
    }
    let data = try JSONSerialization.data(withJSONObject: ["token": token, "apiBase": apiBase, "subject": subject])
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "active"]
    let existing = session()
    if let old = existing?["subject"], old != subject { try clearSession() }
    let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if update == errSecItemNotFound {
      var item = query; item[kSecValueData as String] = data; item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw DeviceRuntimeFailure("DEVICE_PERMISSION_DENIED", "无法保存原生会话") }
    } else if update != errSecSuccess { throw DeviceRuntimeFailure("DEVICE_PERMISSION_DENIED", "无法更新原生会话") }
  }
  public func session() -> [String: String]? {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "active", kSecReturnData as String: true]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
  }
  public func clearSession() throws {
    lock.lock(); defer { lock.unlock() }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "active"]
    let hadSession = session() != nil
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw DeviceRuntimeFailure("DEVICE_PERMISSION_DENIED", "无法清除原生会话") }
    if hadSession {
      state.requests = state.requests.filter { request in state.applications.contains { $0.appId == request.appId && $0.guest } }
      try save()
    }
  }
  /** Only navigation links are accepted; links never execute arbitrary native or cloud writes. */
  @discardableResult public func handle(_ url: URL) -> Bool {
    let custom = url.scheme == "tbox" && url.host == "open"
    let configured = Bundle.main.object(forInfoDictionaryKey: "TBoxNavigationOrigin") as? String ?? ""
    let expected = URL(string: configured)
    let universal = url.scheme == "https" && expected != nil && url.host == expected?.host && url.port == expected?.port && url.path.hasPrefix("/open/")
    guard custom || universal, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), url.user == nil, url.password == nil else { return false }
    let appId = (universal ? String(url.path.dropFirst(6)) : url.path).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    var params: [String: String] = [:]
    for item in parts.queryItems ?? [] {
      guard !["token", "password", "authorization"].contains(item.name.lowercased()), params[item.name] == nil else { return false }
      params[item.name] = item.value ?? ""
    }
    return (try? enqueue(appId: appId, params: params)) != nil
  }
}
