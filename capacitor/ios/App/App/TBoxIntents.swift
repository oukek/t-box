import AppIntents
import TBoxCapacitorDeviceRuntime

@available(iOS 16.0, *)
struct TBoxApplicationEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "T方舟 应用"
  static var defaultQuery = TBoxApplicationQuery()
  var id: String
  var name: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}
@available(iOS 16.0, *)
struct TBoxApplicationQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [TBoxApplicationEntity] {
    DeviceRuntimeStore.shared.applications().filter { identifiers.contains($0.appId) }.map { TBoxApplicationEntity(id: $0.appId, name: $0.name) }
  }
  func suggestedEntities() async throws -> [TBoxApplicationEntity] {
    DeviceRuntimeStore.shared.applications().map { TBoxApplicationEntity(id: $0.appId, name: $0.name) }
  }
  func entities(matching string: String) async throws -> [TBoxApplicationEntity] {
    try await suggestedEntities().filter { $0.name.localizedCaseInsensitiveContains(string) }
  }
}
@available(iOS 16.0, *)
struct OpenTBoxApplicationIntent: AppIntent {
  static var title: LocalizedStringResource = "打开 T方舟 应用"
  static var description = IntentDescription("打开已安装的应用。本地系统工具可以离线使用。")
  static var openAppWhenRun = true
  @Parameter(title: "应用") var application: TBoxApplicationEntity
  @MainActor func perform() async throws -> some IntentResult {
    try DeviceRuntimeStore.shared.enqueue(appId: application.id)
    return .result()
  }
}
@available(iOS 16.0, *)
struct TBoxShortcutEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "已保存的快捷动作"
  static var defaultQuery = TBoxShortcutQuery()
  var id: String
  var name: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}
@available(iOS 16.0, *)
struct TBoxShortcutQuery: EntityStringQuery {
  func suggestedEntities() async throws -> [TBoxShortcutEntity] {
    let store = DeviceRuntimeStore.shared
    return store.templates().filter { $0.subject == store.session()?["subject"] }.map { TBoxShortcutEntity(id: $0.id, name: $0.title) }
  }
  func entities(for identifiers: [String]) async throws -> [TBoxShortcutEntity] { try await suggestedEntities().filter { identifiers.contains($0.id) } }
  func entities(matching string: String) async throws -> [TBoxShortcutEntity] { try await suggestedEntities().filter { $0.name.localizedCaseInsensitiveContains(string) } }
}
@available(iOS 16.0, *)
struct RunTBoxShortcutIntent: AppIntent {
  static var title: LocalizedStringResource = "执行 T方舟 快捷动作"
  static var description = IntentDescription("执行在应用内确认保存的动作，返回结果供后续快捷指令使用。云端动作需要联网和有效登录。")
  static var openAppWhenRun = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "快捷动作") var shortcut: TBoxShortcutEntity
  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    let result = try await DeviceRuntimeStore.shared.executeTemplate(shortcut.id)
    return .result(value: result)
  }
}
@available(iOS 16.0, *)
struct TBoxAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: OpenTBoxApplicationIntent(), phrases: ["在 \(.applicationName) 中打开应用"], shortTitle: "打开应用", systemImageName: "square.grid.2x2")
    AppShortcut(intent: RunTBoxShortcutIntent(), phrases: ["使用 \(.applicationName) 执行快捷动作"], shortTitle: "执行快捷动作", systemImageName: "bolt")
  }
}
