import type { PaymentIntent, WechatJsSdkConfiguration } from '@t-box/shared'
import { request } from '../../core/network'
import { configureWechatSdk, wechatSigningUrl } from '../../core/wechatSdk'
import { ErrorCode } from '../../error-codes.js'
import { isWechatPayBrowser } from './paymentEnvironment'

type Parameters = Extract<PaymentIntent, { type: 'jsapi' }>['parameters']
export async function chooseWechatPay(orderId: string, parameters: Parameters, options: { configuration?: (url: string) => Promise<WechatJsSdkConfiguration>, active?: () => boolean } = {}) {
  if (!isWechatPayBrowser(navigator.userAgent, matchMedia('(pointer:coarse)').matches, navigator.maxTouchPoints)) {
    throw ErrorCode.INTERNAL_PAYMENT_METHOD_UNSUPPORTED('请在手机微信中打开支付链接')
  }
  const ensureActive = () => {
    if (options.active && !options.active()) {
      throw new DOMException('Payment page closed', 'AbortError')
    }
  }
  const url = wechatSigningUrl()
  const configuration = options.configuration ? await options.configuration(url) : (await request<{ data: WechatJsSdkConfiguration }>(`/payments/orders/${orderId}/js-sdk`, { method: 'POST', body: JSON.stringify({ url }), timeoutMs: 25_000 })).data
  ensureActive()
  if (configuration.appId !== parameters.appId) {
    throw ErrorCode.INTERNAL_INVALID_WECHAT_PAYMENT_URL('微信登录与支付的公众号 AppID 不一致')
  }
  const sdk = await configureWechatSdk(configuration)
  ensureActive()
  return new Promise<'ok' | 'cancel' | 'fail'>((resolve, reject) => {
    const deadline = setTimeout(() => reject(ErrorCode.INTERNAL_PAYMENT_RESULT_UNKNOWN()), 120_000)
    const finish = (result: 'ok' | 'cancel' | 'fail') => {
      clearTimeout(deadline)
      resolve(result)
    }
    const { appId: _appId, timeStamp, ...signed } = parameters
    sdk.chooseWXPay({ ...signed, timestamp: Number(timeStamp), success: () => finish('ok'), cancel: () => finish('cancel'), fail: () => finish('fail') })
  })
}
