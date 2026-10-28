import type { WechatPaymentMode } from '@t-box/shared'

export const IOS_PURCHASE_UNAVAILABLE = 'iOS 应用内购暂时不可用'

/** AI credit purchases are unavailable in the iOS shell until IAP is integrated. */
export function billingPurchaseBlockReason(
  native: boolean,
  platform: string,
): string | null {
  return native && platform === 'ios' ? IOS_PURCHASE_UNAVAILABLE : null
}

/** Native platform detection takes priority over WebView's mobile user-agent. */
export function selectPaymentMode(
  native: boolean,
  userAgent: string,
  coarsePointer: boolean,
): WechatPaymentMode {
  if (native) {
    return 'app'
  }
  if (/MicroMessenger/i.test(userAgent)) {
    return 'jsapi'
  }
  return /Android|iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && coarsePointer)
    ? 'h5'
    : 'jsapi'
}

export function isWechatPayBrowser(userAgent: string, coarsePointer = false, touchPoints = 0) {
  return /MicroMessenger/i.test(userAgent) && (/Android|iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && (coarsePointer || touchPoints > 1)))
}
export function usesWechatCheckoutLink(native: boolean, userAgent: string, coarsePointer: boolean, touchPoints = 0) {
  return !native && !isWechatPayBrowser(userAgent, coarsePointer, touchPoints) && selectPaymentMode(native, userAgent, coarsePointer) === 'jsapi'
}
