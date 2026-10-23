import Capacitor
import EventKit
import EventKitUI
import UIKit

@objc(DeviceRuntimePlugin)
public class DeviceRuntimePlugin: CAPPlugin, CAPBridgedPlugin, EKEventEditViewDelegate {
  public let identifier = "DeviceRuntimePlugin"
  public let jsName = "TBoxDeviceRuntime"
  public let pluginMethods: [CAPPluginMethod] = ["templates", "saveTemplate", "removeTemplate", "sessionStatus", "environment", "permissions", "grant", "revoke", "invoke", "configureApplications", "pending", "acknowledge", "setSession", "clearSession"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
  private let store = DeviceRuntimeStore.shared
  private let events = EKEventStore()
  private let supported = ["phone.dial", "calendar.presentCreate", "calendar.create", "calendar.list", "calendar.update", "calendar.remove", "share.present", "system.openSettings"]
  public override func load() {
    NotificationCenter.default.addObserver(self, selector: #selector(openRequest), name: NSNotification.Name("TBoxOpenRequest"), object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(openRequest), name: UIApplication.didBecomeActiveNotification, object: nil)
  }
  deinit { NotificationCenter.default.removeObserver(self) }
  @objc private func openRequest() { notifyListeners("openRequest", data: [:]) }
  private var activeCall: CAPPluginCall?
  private var activeScope = ""
  private var activeRequest = ""
  private var editor: EKEventEditViewController?

  private func reject(_ call: CAPPluginCall, _ error: Error) {
    if let error = error as? DeviceRuntimeFailure { call.reject(error.message, error.code) }
    else { call.reject("系统操作未能完成，请检查设备权限后重试", "DEVICE_ERROR") }
  }
  @objc public func sessionStatus(_ call: CAPPluginCall) {
    let session = store.session()
    call.resolve(["subject": session?["subject"] ?? "", "parent": session?["token"]?.split(separator: "_").dropFirst().first.map(String.init) ?? ""])
  }
  @objc public func templates(_ call: CAPPluginCall) {
    do { let data = try JSONEncoder().encode(store.templates().filter { $0.subject == store.session()?["subject"] }); call.resolve(["templates": try JSONSerialization.jsonObject(with: data)]) } catch { reject(call, error) }
  }
  @objc public func saveTemplate(_ call: CAPPluginCall) {
    do {
      guard let value = call.getObject("template") else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "快捷动作参数无效") }
      try store.saveTemplate(JSONDecoder().decode(DeviceShortcutTemplate.self, from: JSONSerialization.data(withJSONObject: value))); call.resolve()
    } catch { reject(call, error) }
  }
  @objc public func removeTemplate(_ call: CAPPluginCall) {
    guard let id = call.getString("id") else { call.reject("动作标识无效", "INVALID_ARGUMENTS"); return }
    do { try store.removeTemplate(id); call.resolve() } catch { reject(call, error) }
  }
  @objc public func environment(_ call: CAPPluginCall) { call.resolve(["platform": "ios", "capabilities": supported]) }
  @objc public func permissions(_ call: CAPPluginCall) {
    guard let scope = call.getString("scope"), !scope.isEmpty, scope.count <= 200 else { call.reject("权限范围无效", "INVALID_ARGUMENTS"); return }
    call.resolve(["capabilities": store.permissions(scope)])
  }
  private func change(_ call: CAPPluginCall, allow: Bool) {
    guard let scope = call.getString("scope"), let capabilities = call.getArray("capabilities", String.self), !capabilities.isEmpty,
      Set(capabilities).count == capabilities.count, capabilities.allSatisfy({ supported.contains($0) }) else { call.reject("权限参数无效", "INVALID_ARGUMENTS"); return }
    do { try store.changeGrant(scope, capabilities, allow: allow); call.resolve() } catch { reject(call, error) }
  }
  @objc public func grant(_ call: CAPPluginCall) { change(call, allow: true) }
  @objc public func revoke(_ call: CAPPluginCall) { change(call, allow: false) }
  @objc public func configureApplications(_ call: CAPPluginCall) {
    do {
      let data = try JSONSerialization.data(withJSONObject: call.getArray("applications") ?? [])
      try store.configure(JSONDecoder().decode([DeviceApplication].self, from: data)); call.resolve()
    } catch { reject(call, error) }
  }
  @objc public func pending(_ call: CAPPluginCall) {
    do {
      let data = try JSONEncoder().encode(store.pending())
      call.resolve(["requests": try JSONSerialization.jsonObject(with: data)])
    } catch { reject(call, error) }
  }
  @objc public func acknowledge(_ call: CAPPluginCall) {
    guard let id = call.getString("id") else { call.reject("请求标识无效", "INVALID_ARGUMENTS"); return }
    do { try store.acknowledge(id); call.resolve() } catch { reject(call, error) }
  }
  @objc public func setSession(_ call: CAPPluginCall) {
    guard let token = call.getString("token"), let apiBase = call.getString("apiBase"), let subject = call.getString("subject") else { call.reject("原生会话配置无效", "INVALID_ARGUMENTS"); return }
    do { try store.setSession(token: token, apiBase: apiBase, subject: subject); call.resolve() } catch { reject(call, error) }
  }
  @objc public func clearSession(_ call: CAPPluginCall) { do { try store.clearSession(); call.resolve() } catch { reject(call, error) } }

  @objc public func invoke(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      guard UIApplication.shared.applicationState == .active else { call.reject("请打开应用继续", "DEVICE_FOREGROUND_REQUIRED"); return }
      guard self.activeCall == nil else { call.reject("另一个系统窗口尚未结束", "DEVICE_BUSY"); return }
      guard let scope = call.getString("scope"), let capability = call.getString("capability"), self.supported.contains(capability), self.store.permissions(scope).contains(capability),
        let args = call.getObject("arguments"), let requestId = call.getString("requestId") else { call.reject("未授权此设备能力或参数无效", "DEVICE_PERMISSION_DENIED"); return }
      self.activeCall = call; self.activeScope = scope; self.activeRequest = requestId
      Task { @MainActor in
        do {
          try self.validate(capability, args)
          if capability != "calendar.list", let result = try self.store.begin(scope: scope, requestId: requestId, capability: capability, arguments: args) {
            self.finish(result); return
          }
          switch capability {
          case "phone.dial":
            let number = (args["number"] as! String).addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "+0123456789"))!
            await self.open(URL(string: "tel:" + number)!)
          case "system.openSettings": await self.open(URL(string: UIApplication.openSettingsURLString)!)
          case "share.present": try self.share(args)
          case "calendar.presentCreate":
            if #unavailable(iOS 17.0) { try await self.authorize(full: false) }
            try self.presentEvent(args)
          case "calendar.create":
            try await self.authorize(full: false)
            let event = EKEvent(eventStore: self.events); event.calendar = self.events.defaultCalendarForNewEvents
            try self.fill(event, args)
            try self.events.save(event, span: .thisEvent, commit: true)
            self.finish(["status": "saved", "id": event.eventIdentifier ?? ""])
          case "calendar.list":
            try await self.authorize(full: true)
            let from = try self.date(args["from"]), to = try self.date(args["to"])
            let result = self.events.events(matching: self.events.predicateForEvents(withStart: from, end: to, calendars: nil))
            var entries: [[String: Any]] = [], bytes = 0
            for event in result.prefix(100) {
              let entry = self.describe(event)
              let size = (try? JSONSerialization.data(withJSONObject: entry).count) ?? 64000
              if bytes + size > 48000 { break }
              bytes += size; entries.append(entry)
            }
            self.finish(["events": entries, "truncated": result.count > entries.count])
          case "calendar.update", "calendar.remove":
            try await self.authorize(full: true)
            guard let id = args["id"] as? String, let event = self.events.event(withIdentifier: id) else { throw DeviceRuntimeFailure("DEVICE_EVENT_NOT_FOUND", "系统日历事件不存在或已被删除") }
            if capability == "calendar.remove" {
              try self.events.remove(event, span: .thisEvent, commit: true); self.finish(["status": "removed"])
            } else {
              try self.fill(event, args["event"] as! [String: Any]); try self.events.save(event, span: .thisEvent, commit: true)
              self.finish(["status": "saved", "id": event.eventIdentifier ?? id])
            }
          default: throw DeviceRuntimeFailure("DEVICE_UNSUPPORTED", "当前设备不支持此能力")
          }
        } catch {
          // Failures before/while authorization are known not to have written. Unknown OS write outcomes remain fenced.
          if let failure = error as? DeviceRuntimeFailure, ["INVALID_ARGUMENTS", "DEVICE_PERMISSION_DENIED", "DEVICE_EVENT_NOT_FOUND", "DEVICE_UNSUPPORTED"].contains(failure.code) {
            try? self.store.discard(scope: scope, requestId: requestId)
          }
          self.reject(call, error); self.reset()
        }
      }
    }
  }
  @MainActor private func authorize(full: Bool) async throws {
    let status = EKEventStore.authorizationStatus(for: .event)
    let allowed: Bool
    if #available(iOS 17.0, *) {
      if status == .fullAccess || (!full && status == .writeOnly) { return }
      allowed = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Bool, Error>) in
        let done: @Sendable (Bool, Error?) -> Void = { granted, _ in continuation.resume(returning: granted) }
        if full { events.requestFullAccessToEvents(completion: done) } else { events.requestWriteOnlyAccessToEvents(completion: done) }
      }
    } else {
      if status == .authorized { return }
      allowed = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Bool, Error>) in
        events.requestAccess(to: .event) { granted, _ in continuation.resume(returning: granted) }
      }
    }
    guard allowed else { throw DeviceRuntimeFailure("DEVICE_PERMISSION_DENIED", "未获得系统日历权限，可在系统设置中调整") }
    events.reset()
  }
  private func date(_ value: Any?) throws -> Date {
    guard let value = value as? String, value.range(of: "(?:Z|[+-][0-9]{2}:[0-9]{2})$", options: .regularExpression) != nil else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "日期必须包含时区") }
    let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = format.date(from: value) { return date }
    format.formatOptions = [.withInternetDateTime]
    guard let date = format.date(from: value) else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "日期无效") }
    return date
  }
  private func draft(_ args: [String: Any]) throws {
    let allowed = Set(["title", "startAt", "endAt", "timeZone", "allDay", "location", "notes", "reminderMinutes"])
    guard Set(args.keys).isSubset(of: allowed), let title = args["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.count <= 200,
      try date(args["endAt"]) > date(args["startAt"]) else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "日历事件参数无效") }
    if let zone = args["timeZone"] { guard let name = zone as? String, TimeZone(identifier: name) != nil else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "时区无效") } }
    for (key, limit) in [("notes", 5000), ("location", 500)] {
      if let value = args[key] { guard let text = value as? String, text.count <= limit else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "事件文本过长") } }
    }
    if let alarms = args["reminderMinutes"] { guard let values = alarms as? [Int], values.count <= 3, values.allSatisfy({ $0 >= 0 && $0 <= 40320 }) else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "提醒时间无效") } }
  }
  private func validate(_ capability: String, _ args: [String: Any]) throws {
    if ["calendar.create", "calendar.presentCreate"].contains(capability) { try draft(args); return }
    switch capability {
    case "phone.dial": guard args.count == 1, let number = args["number"] as? String, number.range(of: "^\\+?[0-9]{3,20}$", options: .regularExpression) != nil else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "电话号码无效") }
    case "calendar.list":
      guard Set(args.keys) == Set(["from", "to"]) else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "日期范围无效") }
      let difference = try date(args["to"]).timeIntervalSince(date(args["from"]))
      guard difference > 0 && difference <= 366 * 86400 else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "最多查询一年的日历事件") }
    case "calendar.update":
      guard Set(args.keys) == Set(["id", "event"]), let id = args["id"] as? String, !id.isEmpty, id.count <= 1024, let event = args["event"] as? [String: Any] else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "事件参数无效") }
      try draft(event)
    case "calendar.remove": guard args.count == 1, let id = args["id"] as? String, !id.isEmpty, id.count <= 1024 else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "事件标识无效") }
    case "share.present": guard Set(args.keys).isSubset(of: Set(["title", "text"])), let text = args["text"] as? String, !text.isEmpty, text.count <= 10000 else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "分享内容无效") }
    case "system.openSettings": guard args.isEmpty else { throw DeviceRuntimeFailure("INVALID_ARGUMENTS", "设置参数无效") }
    default: throw DeviceRuntimeFailure("DEVICE_UNSUPPORTED", "设备能力不可用")
    }
  }
  private func fill(_ event: EKEvent, _ args: [String: Any]) throws {
    event.title = args["title"] as? String
    event.startDate = try date(args["startAt"]); event.endDate = try date(args["endAt"])
    event.isAllDay = args["allDay"] as? Bool ?? false
    event.timeZone = (args["timeZone"] as? String).flatMap(TimeZone.init(identifier:)) ?? TimeZone.current
    event.location = args["location"] as? String; event.notes = args["notes"] as? String
    event.alarms = (args["reminderMinutes"] as? [Int] ?? []).map { EKAlarm(relativeOffset: -Double($0) * 60) }
  }
  private func describe(_ event: EKEvent) -> [String: Any] {
    let format = ISO8601DateFormatter()
    return ["id": event.eventIdentifier ?? "", "title": String((event.title ?? "").prefix(200)), "startAt": format.string(from: event.startDate), "endAt": format.string(from: event.endDate), "allDay": event.isAllDay, "timeZone": event.timeZone?.identifier ?? TimeZone.current.identifier, "notes": String((event.notes ?? "").prefix(300)), "location": String((event.location ?? "").prefix(200))]
  }
  private func presenter() throws -> UIViewController {
    guard var controller = bridge?.viewController else { throw DeviceRuntimeFailure("DEVICE_FOREGROUND_REQUIRED", "请打开应用继续") }
    while let current = controller.presentedViewController { controller = current }
    return controller
  }
  private func presentEvent(_ args: [String: Any]) throws {
    let edit = EKEventEditViewController(); edit.eventStore = events
    let event = EKEvent(eventStore: events); try fill(event, args)
    edit.event = event; edit.editViewDelegate = self; editor = edit
    try presenter().present(edit, animated: true)
  }
  public func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
    var result: [String: Any] = ["status": action == .saved ? "saved" : "cancelled"]
    if action == .saved, let id = controller.event?.eventIdentifier { result["id"] = id }
    controller.dismiss(animated: true) { self.finish(result) }
  }
  @MainActor private func open(_ url: URL) async {
    let opened = await UIApplication.shared.open(url)
    if opened { finish(["status": "handed_off"]) }
    else if let call = activeCall { reject(call, DeviceRuntimeFailure("DEVICE_UNSUPPORTED", "此设备无法打开该系统功能")); try? store.discard(scope: activeScope, requestId: activeRequest); reset() }
  }
  private func share(_ args: [String: Any]) throws {
    let controller = UIActivityViewController(activityItems: [args["text"] as! String], applicationActivities: nil)
    if let title = args["title"] as? String { controller.setValue(title, forKey: "subject") }
    let parent = try presenter()
    controller.popoverPresentationController?.sourceView = parent.view
    controller.popoverPresentationController?.sourceRect = CGRect(x: parent.view.bounds.midX, y: parent.view.bounds.midY, width: 1, height: 1)
    controller.completionWithItemsHandler = { _, completed, _, _ in self.finish(["status": completed ? "shared" : "cancelled"]) }
    parent.present(controller, animated: true)
  }
  private func finish(_ result: [String: Any]) {
    guard let call = activeCall else { return }
    do { if call.getString("capability") != "calendar.list" { try store.complete(scope: activeScope, requestId: activeRequest, result: result) }; call.resolve(result) }
    catch { reject(call, DeviceRuntimeFailure("DEVICE_RESULT_UNKNOWN", "系统操作已执行，但结果保存失败，请先核对")) }
    reset()
  }
  private func reset() { activeCall = nil; activeScope = ""; activeRequest = ""; editor = nil }
}
