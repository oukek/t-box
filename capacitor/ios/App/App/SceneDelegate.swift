import UIKit
import Capacitor
import TBoxCapacitorWechatPay

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        for context in connectionOptions.urlContexts { _ = TBoxWechatPayDelegate.shared.handle(context.url) }
        for activity in connectionOptions.userActivities { _ = TBoxWechatPayDelegate.shared.handle(activity) }
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        let unhandled = URLContexts.filter { !TBoxWechatPayDelegate.shared.handle($0.url) }
        if !unhandled.isEmpty { SceneDelegateProxy.shared.scene(scene, openURLContexts: Set(unhandled)) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if !TBoxWechatPayDelegate.shared.handle(userActivity) {
            SceneDelegateProxy.shared.scene(scene, continue: userActivity)
        }
    }
}
