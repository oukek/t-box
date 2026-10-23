import Capacitor
import WebKit

/** Every native plugin is privileged. Isolated app frames must use the host SDK instead. */
final class TBoxBridgeViewController: CAPBridgeViewController {
  private var guardedMessages: MainFrameNativeMessages?
  override func capacitorDidLoad() {
    super.capacitorDidLoad()
    guard let bridge = bridge as? CapacitorBridge, let controller = webView?.configuration.userContentController else { return }
    let handler = MainFrameNativeMessages(original: bridge.webViewDelegationHandler, allowed: [bridge.config.localURL, bridge.config.serverURL])
    controller.removeScriptMessageHandler(forName: "bridge")
    controller.add(handler, name: "bridge")
    guardedMessages = handler
  }
}
private final class MainFrameNativeMessages: NSObject, WKScriptMessageHandler {
  private weak var original: WKScriptMessageHandler?
  private let allowed: [URL]
  init(original: WKScriptMessageHandler, allowed: [URL]) { self.original = original; self.allowed = allowed }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    let origin = message.frameInfo.securityOrigin
    guard NativeBridgePolicy.allows(mainFrame: message.frameInfo.isMainFrame, scheme: origin.protocol, host: origin.host, port: origin.port, allowed: allowed) else { return }
    original?.userContentController(controller, didReceive: message)
  }
}
