import Foundation
import UIKit
import WechatOpenSDK

/** Shared SDK delegate also handles callbacks before the Capacitor bridge exists. */
public final class TBoxWechatPayDelegate: NSObject, WXApiDelegate {
    public static let shared = TBoxWechatPayDelegate()
    public static let resultNotification = Notification.Name("TBoxWechatPayResult")
    public private(set) var registered = false
    public var pendingUntil: TimeInterval = 0
    public var appId: String { Bundle.main.object(forInfoDictionaryKey: "TBoxWechatAppId") as? String ?? "" }
    public var enabled: Bool { Bundle.main.object(forInfoDictionaryKey: "TBoxWechatEnabled") as? Bool ?? false }
    private var universalLink: String { Bundle.main.object(forInfoDictionaryKey: "TBoxWechatUniversalLink") as? String ?? "" }
    public func registerFromBundle() {
        guard !registered, enabled, appId.range(of: "^wx[A-Za-z0-9]{8,30}$", options: .regularExpression) != nil,
            let link = URL(string: universalLink), link.scheme == "https", link.host != nil, universalLink.hasSuffix("/") else { return }
        registered = WXApi.registerApp(appId, universalLink: universalLink)
    }
    public func handle(_ url: URL) -> Bool {
        registerFromBundle()
        guard registered, url.scheme == appId else { return false }
        return WXApi.handleOpen(url, delegate: self)
    }
    public func handle(_ activity: NSUserActivity) -> Bool {
        registerFromBundle()
        guard registered, activity.activityType == NSUserActivityTypeBrowsingWeb,
            let url = activity.webpageURL, let link = URL(string: universalLink),
            url.scheme == "https", url.host == link.host, url.path.hasPrefix(link.path) else { return false }
        return WXApi.handleOpenUniversalLink(activity, delegate: self)
    }
    public func onResp(_ resp: BaseResp) {
        guard resp is PayResp else { return }
        pendingUntil = 0
        // Not proof of payment. Consumers always ask the authenticated server to query.
        NotificationCenter.default.post(name: Self.resultNotification, object: nil, userInfo: ["code": resp.errCode])
    }
}
