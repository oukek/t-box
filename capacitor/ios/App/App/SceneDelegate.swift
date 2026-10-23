import UIKit
import Capacitor
import TBoxCapacitorWechatPay
import TBoxCapacitorDeviceRuntime

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = TBoxBridgeViewController()
        window?.makeKeyAndVisible()

        for context in connectionOptions.urlContexts { if !DeviceRuntimeStore.shared.handle(context.url) { _ = TBoxWechatPayDelegate.shared.handle(context.url) } }
        for activity in connectionOptions.userActivities { if let url = activity.webpageURL, DeviceRuntimeStore.shared.handle(url) { continue }; _ = TBoxWechatPayDelegate.shared.handle(activity) }
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        let unhandled = URLContexts.filter { !DeviceRuntimeStore.shared.handle($0.url) && !TBoxWechatPayDelegate.shared.handle($0.url) }
        if !unhandled.isEmpty { SceneDelegateProxy.shared.scene(scene, openURLContexts: Set(unhandled)) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if let url = userActivity.webpageURL, DeviceRuntimeStore.shared.handle(url) { return }
        if !TBoxWechatPayDelegate.shared.handle(userActivity) {
            SceneDelegateProxy.shared.scene(scene, continue: userActivity)
        }
    }
}
