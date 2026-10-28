import type { PaymentIntent, WechatJsSdkConfiguration } from '@t-box/shared'
import { ErrorCode } from '../error-codes.js'

type PayParameters = Extract<PaymentIntent, { type: 'jsapi' }>['parameters']
export interface WechatShareData {
  title: string
  desc: string
  link: string
  imgUrl: string
}
interface ShareCallbacks {
  success(): void
  fail(): void
}
export interface WechatSdk {
  config(input: WechatJsSdkConfiguration & { debug: boolean, jsApiList: string[] }): void
  ready(callback: () => void): void
  error(callback: () => void): void
  updateAppMessageShareData(input: WechatShareData & ShareCallbacks): void
  updateTimelineShareData(input: Omit<WechatShareData, 'desc'> & ShareCallbacks): void
  chooseWXPay(input: Omit<PayParameters, 'appId' | 'timeStamp'> & {
    timestamp: number
    success(): void
    cancel(): void
    fail(): void
  }): void
}

const entryUrl = location.href.split('#')[0]!
let loading: Promise<WechatSdk> | undefined
let configuring: Promise<unknown> = Promise.resolve()
const currentSdk = () => (window as Window & { wx?: WechatSdk }).wx

export function wechatSigningUrl() {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  return ios ? entryUrl : location.href.split('#')[0]!
}

export async function loadWechatSdk(): Promise<WechatSdk> {
  if (currentSdk()) {
    return currentSdk()!
  }
  loading ??= new Promise<WechatSdk>((resolve, reject) => {
    const script = document.createElement('script')
    let timer: ReturnType<typeof setTimeout>
    const finish = (failed = false) => {
      clearTimeout(timer)
      script.onload = null
      script.onerror = null
      if (failed || !currentSdk()) {
        script.remove()
        reject(ErrorCode.INTERNAL_APPLICATION_EXECUTION_FAILED('微信 SDK 加载失败，请检查网络后重试'))
      } else {
        resolve(currentSdk()!)
      }
    }
    timer = setTimeout(finish, 12_000, true)
    script.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js'
    script.async = true
    script.referrerPolicy = 'no-referrer'
    script.onload = () => finish()
    script.onerror = () => finish(true)
    document.head.append(script)
  }).catch((cause) => {
    loading = undefined
    throw cause
  })
  return loading
}

export function configureWechatSdk(configuration: WechatJsSdkConfiguration) {
  const pending = configuring.then(async () => {
    const sdk = await loadWechatSdk()
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
          reject(ErrorCode.INTERNAL_APPLICATION_EXECUTION_FAILED('微信 SDK 验证失败，请检查公众号 JS 接口安全域名'))
        } else {
          resolve()
        }
      }
      timer = setTimeout(finish, 10_000, true)
      // Both features retain their APIs when the other reconfigures the shared SDK.
      sdk.config({ ...configuration, debug: false, jsApiList: ['chooseWXPay', 'updateAppMessageShareData', 'updateTimelineShareData'] })
      sdk.ready(() => finish(false))
      sdk.error(() => finish(true))
    })
    return sdk
  })
  configuring = pending.catch(() => {})
  return pending
}

export async function updateWechatShareData(sdk: WechatSdk, data: WechatShareData) {
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(ErrorCode.INTERNAL_APPLICATION_EXECUTION_FAILED('微信分享配置超时')), 8000)
      sdk.updateAppMessageShareData({ ...data, success: () => {
        clearTimeout(timer)
        resolve()
      }, fail: () => {
        clearTimeout(timer)
        reject(ErrorCode.INTERNAL_APPLICATION_EXECUTION_FAILED('微信分享配置失败'))
      } })
    }),
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(ErrorCode.INTERNAL_APPLICATION_EXECUTION_FAILED('朋友圈分享配置超时')), 8000)
      sdk.updateTimelineShareData({ title: data.title, link: data.link, imgUrl: data.imgUrl, success: () => {
        clearTimeout(timer)
        resolve()
      }, fail: () => {
        clearTimeout(timer)
        reject(ErrorCode.INTERNAL_APPLICATION_EXECUTION_FAILED('朋友圈分享配置失败'))
      } })
    }),
  ])
}

export function clearWechatShareData(data: WechatShareData) {
  const sdk = currentSdk()
  if (sdk) {
    try {
      sdk.updateAppMessageShareData({ ...data, success() {}, fail() {} })
      sdk.updateTimelineShareData({ title: data.title, link: data.link, imgUrl: data.imgUrl, success() {}, fail() {} })
    } catch { /* A new document or the next login will configure the menu again. */ }
  }
}
