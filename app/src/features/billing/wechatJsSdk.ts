import type { PaymentIntent, WechatJsSdkConfiguration } from '@t-box/shared'
import { request } from '../../core/network'
import { ErrorCode } from '../../error-codes.js'
import { isWechatPayBrowser } from './paymentEnvironment'

type Parameters = Extract<PaymentIntent, { type: 'jsapi' }>['parameters']
interface WechatSdk {
  config(input: WechatJsSdkConfiguration & { debug: boolean, jsApiList: string[] }): void
  ready(callback: () => void): void
  error(callback: () => void): void
  chooseWXPay(input: Omit<Parameters, 'appId' | 'timeStamp'> & {
    timestamp: number
    success(): void
    cancel(): void
    fail(): void
  }): void
}
const entryUrl = location.href.split('#')[0]!
let loading: Promise<WechatSdk> | undefined

async function load(): Promise<WechatSdk> {
  const sdk = () => (window as Window & { wx?: WechatSdk }).wx
  if (sdk()) {
    return sdk()!
  }
  loading ??= new Promise<WechatSdk>((resolve, reject) => {
    const script = document.createElement('script')
    let timer: ReturnType<typeof setTimeout>
    const finish = (failed = false) => {
      clearTimeout(timer)
      script.onload = null
      script.onerror = null
      if (failed || !sdk()) {
        script.remove()
        reject(ErrorCode.INTERNAL_APPLICATION_EXECUTION_FAILED('微信 SDK 加载失败，请检查网络后重试'))
      } else {
        resolve(sdk()!)
      }
    }
    timer = setTimeout(finish, 12_000, true)
    script.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js'
    script.async = true
    script.referrerPolicy = 'no-referrer'
    script.onload = () => finish()
    script.onerror = () => finish(true)
    document.head.append(script)
  }).catch((error) => {
    loading = undefined
    throw error
  })
  return loading
}

export async function chooseWechatPay(orderId: string, parameters: Parameters, options: { configuration?: (url: string) => Promise<WechatJsSdkConfiguration>, active?: () => boolean } = {}) {
  if (!isWechatPayBrowser(navigator.userAgent, matchMedia('(pointer:coarse)').matches, navigator.maxTouchPoints)) {
    throw ErrorCode.INTERNAL_PAYMENT_METHOD_UNSUPPORTED('请在手机微信中打开支付链接')
  }
  const ensureActive = () => {
    if (options.active && !options.active()) {
      throw new DOMException('Payment page closed', 'AbortError')
    }
  }
  const sdk = await load()
  ensureActive()
  // iOS WeChat keeps the document-entry URL across history.replaceState/hash navigation.
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  const url = ios ? entryUrl : location.href.split('#')[0]!
  const configuration = options.configuration ? await options.configuration(url) : (await request<{ data: WechatJsSdkConfiguration }>(`/payments/orders/${orderId}/js-sdk`, { method: 'POST', body: JSON.stringify({ url }), timeoutMs: 25_000 })).data
  ensureActive()
  if (configuration.appId !== parameters.appId) {
    throw ErrorCode.INTERNAL_INVALID_WECHAT_PAYMENT_URL('微信登录与支付的公众号 AppID 不一致')
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (failed: boolean) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (failed) {
        reject(ErrorCode.INTERNAL_APPLICATION_EXECUTION_FAILED('微信 SDK 验证失败，请检查 JS 接口安全域名和支付授权目录'))
      } else {
        resolve()
      }
    }
    timer = setTimeout(finish, 10_000, true)
    sdk.config({ ...configuration, debug: false, jsApiList: ['chooseWXPay'] })
    sdk.ready(() => finish(false))
    sdk.error(() => finish(true))
  })
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
