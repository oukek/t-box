import Foundation

/** Only declared JSON pointers can vary; substitutions cannot run code or construct a new operation. */
public enum ShortcutParameters {
  public static func resolve(argumentsJSON: String, bindingsJSON: String?, now: Date = Date()) throws -> [String: Any] {
    guard let data = argumentsJSON.data(using: .utf8), var value = (try JSONSerialization.jsonObject(with: data)) as? [String: Any] else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "动作参数无效") }
    let bindingsData = (bindingsJSON ?? "{}").data(using: .utf8)!
    guard let bindings = (try JSONSerialization.jsonObject(with: bindingsData)) as? [String: String], bindings.count <= 20 else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "动态参数无效") }
    let iso = ISO8601DateFormatter(), day = DateFormatter()
    day.calendar = Calendar(identifier: .gregorian); day.locale = Locale(identifier: "en_US_POSIX"); day.timeZone = .current; day.dateFormat = "yyyy-MM-dd"
    func replace(_ node: Any, _ path: ArraySlice<String>, _ replacement: String) throws -> Any {
      guard let head = path.first else { guard node is String else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "动态参数只能替换已有文本字段") }; return replacement }
      if var object = node as? [String: Any], let existing = object[head] { object[head] = try replace(existing, path.dropFirst(), replacement); return object }
      if var array = node as? [Any], let index = Int(head), index >= 0, index < array.count { array[index] = try replace(array[index], path.dropFirst(), replacement); return array }
      throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "动态参数路径不存在")
    }
    for (pointer, kind) in bindings.sorted(by: { $0.key < $1.key }) {
      guard pointer.hasPrefix("/"), pointer.count <= 200, ["now", "today"].contains(kind) else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "动态参数类型无效") }
      let path = pointer.dropFirst().components(separatedBy: "/").map { $0.replacingOccurrences(of: "~1", with: "/").replacingOccurrences(of: "~0", with: "~") }
      guard let replaced = try replace(value, path[...], kind == "now" ? iso.string(from: now) : day.string(from: now)) as? [String: Any] else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "动态参数无效") }
      value = replaced
    }
    return value
  }
}
