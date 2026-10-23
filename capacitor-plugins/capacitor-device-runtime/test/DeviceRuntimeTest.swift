import Foundation

let directory = FileManager.default.temporaryDirectory.appendingPathComponent("tbox-native-runtime-test-" + UUID().uuidString)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: directory) }
let service = "com.tbox.test." + UUID().uuidString
let store = DeviceRuntimeStore(directory: directory, keychainService: service)
try store.configure([DeviceApplication(appId: "calculator", name: "计算器", guest: true)])
try store.changeGrant("guest:calculator", ["phone.dial"], allow: true)
precondition(store.permissions("guest:calculator") == ["phone.dial"])
precondition(store.permissions("other:calculator").isEmpty)
let key = try store.enqueue(appId: "calculator", params: ["expression": "1+1"])
precondition(store.pending().first?.id == key)
let restored = DeviceRuntimeStore(directory: directory, keychainService: service)
precondition(restored.pending().first?.params["expression"] == "1+1")
try restored.acknowledge(key)
precondition(restored.pending().isEmpty)
precondition(restored.handle(URL(string: "tbox://open/calculator?expression=2%2B2")!))
precondition(!restored.handle(URL(string: "tbox://open/calculator?token=private")!))
precondition(!restored.handle(URL(string: "tbox://invoke/calculator?expression=2")!))
precondition(!restored.handle(URL(string: "tbox://open/uninstalled")!))
let initialReceipt = try restored.begin(scope: "guest:calculator", requestId: "write-1", capability: "calendar.create", arguments: ["title": "事件"])
precondition(initialReceipt == nil)
do {
  _ = try DeviceRuntimeStore(directory: directory, keychainService: service).begin(scope: "guest:calculator", requestId: "write-1", capability: "calendar.create", arguments: ["title": "事件"])
  fatalError("A crash before receipt confirmation must not repeat the write")
} catch let error as DeviceRuntimeFailure { precondition(error.code == "DEVICE_RESULT_UNKNOWN") }
try restored.complete(scope: "guest:calculator", requestId: "write-1", result: ["status": "saved", "id": "event-1"])
let result = try restored.begin(scope: "guest:calculator", requestId: "write-1", capability: "calendar.create", arguments: ["title": "事件"])
precondition(result?["id"] as? String == "event-1")
do {
  _ = try restored.begin(scope: "guest:calculator", requestId: "write-1", capability: "calendar.create", arguments: ["title": "不同事件"])
  fatalError("A reused request ID with changed arguments must be rejected")
} catch let error as DeviceRuntimeFailure { precondition(error.code == "DEVICE_REQUEST_CONFLICT") }
try restored.changeGrant("guest:calculator", ["phone.dial"], allow: false)
precondition(restored.permissions("guest:calculator").isEmpty)
let allowed = [URL(string: "capacitor://localhost")!, URL(string: "http://192.168.1.10:5173")!]
precondition(NativeBridgePolicy.allows(mainFrame: true, scheme: "capacitor", host: "localhost", port: 0, allowed: allowed))
precondition(NativeBridgePolicy.allows(mainFrame: true, scheme: "http", host: "192.168.1.10", port: 5173, allowed: allowed))
precondition(!NativeBridgePolicy.allows(mainFrame: false, scheme: "capacitor", host: "localhost", port: 0, allowed: allowed))
precondition(!NativeBridgePolicy.allows(mainFrame: true, scheme: "http", host: "127.0.0.1", port: 6176, allowed: allowed))
precondition(!NativeBridgePolicy.allows(mainFrame: true, scheme: "https", host: "localhost", port: 443, allowed: allowed))
precondition(!NativeBridgePolicy.allows(mainFrame: true, scheme: "http", host: "192.168.1.10", port: 5174, allowed: allowed))
let parameters = try ShortcutParameters.resolve(argumentsJSON: "{\"records\":[{\"occurredAt\":\"old\"}],\"title\":\"keep\"}", bindingsJSON: "{\"/records/0/occurredAt\":\"now\"}", now: Date(timeIntervalSince1970: 0))
precondition(((parameters["records"] as? [[String: Any]])?.first?["occurredAt"] as? String) == "1970-01-01T00:00:00Z")
precondition(parameters["title"] as? String == "keep")
do {
  _ = try ShortcutParameters.resolve(argumentsJSON: "{\"count\":1}", bindingsJSON: "{\"/count\":\"now\"}")
  fatalError("Bindings must not replace non-string fields")
} catch let error as DeviceRuntimeFailure { precondition(error.code == "INVALID_ARGUMENTS") }
try Data("not valid JSON".utf8).write(to: directory.appendingPathComponent("runtime.json"))
do {
  _ = try DeviceRuntimeStore(directory: directory, keychainService: service).begin(scope: "guest:calculator", requestId: "write-2", capability: "calendar.create", arguments: [:])
  fatalError("Corrupt operation records must fail closed")
} catch let error as DeviceRuntimeFailure { precondition(error.code == "DEVICE_RESULT_UNKNOWN") }
print("Native device runtime: cold start, scoped permissions, durable write receipts, corrupt state fencing and iframe isolation passed")
