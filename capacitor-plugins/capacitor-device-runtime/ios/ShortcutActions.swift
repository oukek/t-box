import Foundation

public struct DeviceShortcutTemplate: Codable, Sendable {
  public let id: String
  public let appId: String
  public let actionId: String
  public let actionVersion: Int
  public let title: String
  public let releaseId: String
  public let generation: Int
  public let subject: String
  public let argumentsJSON: String
  public let bindingsJSON: String?
}

extension DeviceRuntimeStore {
  private var templateFile: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("TBoxDevice/shortcuts.json")
  }
  public func templates() -> [DeviceShortcutTemplate] {
    lock.lock(); defer { lock.unlock() }
    return (try? JSONDecoder().decode([DeviceShortcutTemplate].self, from: Data(contentsOf: templateFile))) ?? []
  }
  public func saveTemplate(_ value: DeviceShortcutTemplate) throws {
    lock.lock(); defer { lock.unlock() }
    guard Self.validAppId(value.appId), Self.validAppId(value.actionId), value.title.count <= 100, !value.title.isEmpty,
      value.argumentsJSON.utf8.count <= 64000, value.generation > 0, value.actionVersion > 0, value.releaseId.count <= 80,
      let subject = session()?["subject"], subject == value.subject,
      let arguments = value.argumentsJSON.data(using: .utf8), (try JSONSerialization.jsonObject(with: arguments)) is [String: Any] else {
      throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "快捷动作参数或登录状态无效")
    }
    _ = try resolveArguments(value)
    var values = templates().filter { $0.id != value.id }
    guard values.count < 100 else { throw DeviceRuntimeFailure("DEVICE_BUSY", "最多保存 100 个快捷动作") }
    values.append(value)
    try JSONEncoder().encode(values).write(to: templateFile, options: [.atomic])
  }
  public func removeTemplate(_ id: String) throws {
    lock.lock(); defer { lock.unlock() }
    try JSONEncoder().encode(templates().filter { $0.id != id }).write(to: templateFile, options: [.atomic])
  }
  private func resolveArguments(_ template: DeviceShortcutTemplate) throws -> [String: Any] {
    try ShortcutParameters.resolve(argumentsJSON: template.argumentsJSON, bindingsJSON: template.bindingsJSON)
  }
  /** Native networking runs without a WebView. Ordinary API sessions cannot be substituted. */
  public func executeTemplate(_ id: String) async throws -> String {
    guard let template = templates().first(where: { $0.id == id }), let session = session(), session["subject"] == template.subject,
      let token = session["token"], let base = session["apiBase"],
      let url = URL(string: base + "/native/actions/" + template.appId + "/" + template.actionId) else {
      throw DeviceRuntimeFailure("AUTH_REQUIRED", "请打开 T方舟 登录并重新配置快捷动作")
    }
    let payload: [String: Any] = ["releaseId": template.releaseId, "generation": template.generation, "actionVersion": template.actionVersion, "arguments": try resolveArguments(template)]
    let key = UUID().uuidString
    let scope = "shortcut:" + template.subject + ":" + template.id
    _ = try begin(scope: scope, requestId: key, capability: template.actionId, arguments: payload)
    var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 20
    request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(key, forHTTPHeaderField: "Idempotency-Key")
    request.httpBody = try JSONSerialization.data(withJSONObject: payload)
    // Reuse exactly the same request ID across transient transport failures; never restart a write with a new ID.
    var lastError: Error?
    for attempt in 0..<3 {
      do {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw DeviceRuntimeFailure("REQUEST_FAILED", "服务器没有返回有效响应") }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        if (200..<300).contains(http.statusCode) {
          guard let json, let output = json["data"] else { throw DeviceRuntimeFailure("DEVICE_RESULT_UNKNOWN", "服务返回了无法识别的结果，请先在应用中核对") }
          let outputData = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys, .prettyPrinted, .fragmentsAllowed])
          try complete(scope: scope, requestId: key, result: json)
          return String(data: outputData, encoding: .utf8) ?? "null"
        }
        if http.statusCode == 401 { try clearSession() }
        let message = (json?["error"] as? [String: Any])?["message"] as? String ?? "动作执行失败，请打开应用查看"
        // Business errors, expired sessions and generation changes are never blindly retried.
        throw DeviceRuntimeFailure("ACTION_FAILED", message)
      } catch let failure as DeviceRuntimeFailure {
        throw failure
      } catch {
        lastError = error
        if attempt < 2 { try await Task.sleep(nanoseconds: UInt64(attempt + 1) * 500_000_000) }
      }
    }
    _ = lastError
    throw DeviceRuntimeFailure("DEVICE_RESULT_UNKNOWN", "网络中断，动作结果待核对，请先在应用中检查，不要重复提交")
  }
}
