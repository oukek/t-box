import Foundation
import Capacitor
import UIKit
import WechatOpenSDK

@objc(WechatPayPlugin)
public class WechatPayPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WechatPayPlugin"
    public let jsName = "TBoxWechatPay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pay", returnType: CAPPluginReturnPromise),
    ]
    private var observers: [NSObjectProtocol] = []
    public override func load() {
        TBoxWechatPayDelegate.shared.registerFromBundle()
        observers.append(NotificationCenter.default.addObserver(forName: TBoxWechatPayDelegate.resultNotification, object: nil, queue: .main) { [weak self] n in
            self?.notifyListeners("paymentResult", data: ["code": n.userInfo?["code"] as? Int32 ?? -1])
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("foreground", data: [:])
        })
    }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }
    @objc public func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let sdk = TBoxWechatPayDelegate.shared
            sdk.registerFromBundle()
            call.resolve(["enabled": sdk.enabled, "configured": sdk.registered,
                "appId": sdk.appId, "installed": sdk.registered && WXApi.isWXAppInstalled()])
        }
    }
    @objc public func pay(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let sdk = TBoxWechatPayDelegate.shared
            sdk.registerFromBundle()
            guard sdk.registered else { call.reject("原生微信支付尚未配置", "NOT_CONFIGURED"); return }
            let appId = call.getString("appId") ?? "", partner = call.getString("partnerId") ?? "",
                prepay = call.getString("prepayId") ?? "", nonce = call.getString("nonceStr") ?? "",
                timestamp = call.getString("timeStamp") ?? "", signature = call.getString("sign") ?? ""
            func matches(_ value: String, _ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
            guard appId == sdk.appId, matches(partner, "^[0-9]{6,32}$"), matches(prepay, "^[A-Za-z0-9_-]{1,128}$"),
                matches(nonce, "^[A-Za-z0-9_-]{1,32}$"), matches(timestamp, "^[0-9]{10}$"),
                matches(signature, "^[A-Za-z0-9+/]{1,1024}={0,2}$"), call.getString("packageValue") == "Sign=WXPay",
                let time = UInt32(timestamp) else { call.reject("支付参数或移动应用 AppID 不匹配", "INVALID_PARAMETERS"); return }
            guard sdk.pendingUntil <= Date().timeIntervalSince1970 else { call.reject("已有支付正在处理中，请先核对订单或稍后重试", "PAYMENT_BUSY"); return }
            guard WXApi.isWXAppInstalled() else { call.reject("请先安装微信", "WECHAT_NOT_INSTALLED"); return }
            guard WXApi.isWXAppSupport() else { call.reject("请更新微信后再支付", "WECHAT_UNSUPPORTED"); return }
            let req = PayReq()
            // iOS SDK uses the AppID registered at startup; PayReq has no appId property.
            req.partnerId = partner; req.prepayId = prepay
            req.package = "Sign=WXPay"; req.nonceStr = nonce; req.timeStamp = time; req.sign = signature
            sdk.pendingUntil = Date().timeIntervalSince1970 + 120
            WXApi.send(req) { accepted in
                DispatchQueue.main.async {
                    if accepted { call.resolve(["launched": true]) }
                    else { sdk.pendingUntil = 0; call.reject("未能调起微信，请在订单中核对结果", "LAUNCH_FAILED") }
                }
            }
        }
    }
}
