import type { PromotionLink, WechatJsSdkConfiguration } from '@t-box/shared'
import { reactive } from 'vue'
import { apiBase, request } from '../../core/network'
import { identity } from '../../core/session'
import { clearWechatShareData, configureWechatSdk, updateWechatShareData, wechatSigningUrl } from '../../core/wechatSdk'
import { showWechatLogin } from '../identity/wechatLogin'

export const promotionShare = reactive({
  open: false,
  loading: false,
  error: '',
  notice: '',
  sdkNotice: '',
  info: null as PromotionLink | null,
})
const inWechat = /MicroMessenger/i.test(navigator.userAgent)
let pendingOpen = false
let pending: { userId: string, promise: Promise<void> } | undefined
export const promotionAssetUrl = (path: string, parameters: Record<string, string> = {}) => {
  const url = new URL(apiBase + path, location.href)
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value)
  }
  return url.href
}

export function openPromotionShare() {
  if (!identity.user) {
    pendingOpen = true
    showWechatLogin()
    return
  }
  promotionShare.open = true
  promotionShare.notice = ''
  void loadPromotionShare()
}

export function accountChanged(userId?: string) {
  const previous = promotionShare.info
  if (previous && inWechat) {
    clearWechatShareData({
      title: previous.title,
      desc: previous.description,
      link: new URL('/', previous.shareUrl).href,
      imgUrl: promotionAssetUrl(previous.thumbnailPath),
    })
  }
  promotionShare.info = null
  promotionShare.open = false
  promotionShare.error = ''
  promotionShare.sdkNotice = ''
  promotionShare.notice = ''
  pending = undefined
  if (userId && pendingOpen) {
    pendingOpen = false
    openPromotionShare()
  } else if (userId && inWechat) {
    void loadPromotionShare()
  }
}

export function loadPromotionShare() {
  const userId = identity.user?.id
  if (!userId) {
    return Promise.resolve()
  }
  if (pending?.userId === userId) {
    return pending.promise
  }
  promotionShare.loading = true
  promotionShare.error = ''
  const active = { userId, promise: Promise.resolve() }
  active.promise = (async () => {
    try {
      const { data } = await request<{ data: PromotionLink }>('/promotions/me', { method: 'POST' })
      if (identity.user?.id !== userId || pending !== active) {
        return
      }
      promotionShare.info = data
      promotionShare.loading = false
      if (inWechat) {
        try {
          const { data: configuration } = await request<{ data: WechatJsSdkConfiguration }>('/promotions/js-sdk', { method: 'POST', body: JSON.stringify({ url: wechatSigningUrl() }), timeoutMs: 25000 })
          const sdk = await configureWechatSdk(configuration)
          if (identity.user?.id === userId && pending === active) {
            await updateWechatShareData(sdk, { title: data.title, desc: data.description, link: data.shareUrl, imgUrl: promotionAssetUrl(data.thumbnailPath) })
          }
        } catch {
          if (identity.user?.id === userId && pending === active) {
            promotionShare.sdkNotice = '微信菜单分享暂不可用，可长按海报或复制链接分享。'
          }
        }
      }
    } catch (cause) {
      if (identity.user?.id === userId && pending === active) {
        promotionShare.error = cause instanceof Error ? cause.message : '分享海报加载失败，请重试。'
      }
    } finally {
      if (identity.user?.id === userId && pending === active) {
        promotionShare.loading = false
        pending = undefined
      }
    }
  })()
  pending = active
  return active.promise
}

export async function copyPromotionLink() {
  const info = promotionShare.info
  if (!info) {
    return
  }
  try {
    await navigator.clipboard.writeText(info.shareUrl)
    promotionShare.notice = '推广链接已复制'
  } catch {
    promotionShare.notice = '请选中下方链接并复制'
  }
}
