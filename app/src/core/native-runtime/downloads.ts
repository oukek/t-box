import type { HostDownloadSettings } from '@t-box/app-contracts'
import { Capacitor } from '@capacitor/core'
import { defaultHostDownloads, parseHostDownloads } from '@t-box/app-contracts'
import { reactive } from 'vue'

const cacheKey = 'tbox.host.downloads.v1'
export const nativeDownload = reactive({ feature: '', availability: 'mobile' as 'mobile' | 'ios', open: false, loading: false, error: '', settings: { ...defaultHostDownloads } as HostDownloadSettings })
let pending: Promise<void> | undefined

/** Only the host owns download navigation. App code continues to use capability APIs. */
export function promptNativeDownload(feature: string, availability: 'mobile' | 'ios' = 'mobile') {
  if (Capacitor.isNativePlatform()) {
    return false
  }
  nativeDownload.feature = feature
  nativeDownload.availability = availability
  nativeDownload.open = true
  void refreshHostDownloads()
  return true
}

export function refreshHostDownloads(): Promise<void> {
  if (pending) {
    return pending
  }
  try {
    const cached = parseHostDownloads(JSON.parse(localStorage.getItem(cacheKey) || 'null'))
    if (cached) {
      nativeDownload.settings = cached
    }
  } catch { /* Downloads must still be explained when browser storage is unavailable. */ }
  nativeDownload.loading = true
  nativeDownload.error = ''
  const work = async () => {
    try {
      const { request } = await import('../network')
      const response = await request<{ data: unknown }>('/host/downloads', { timeoutMs: 5000 })
      const settings = parseHostDownloads(response.data)
      if (!settings) {
        nativeDownload.error = '应用下载配置暂不可用，请稍后重试。'
        return
      }
      nativeDownload.settings = settings
      try {
        localStorage.setItem(cacheKey, JSON.stringify(settings))
      } catch { /* The current response remains usable without a disk cache. */ }
    } catch {
      nativeDownload.error = navigator.onLine ? '暂时无法获取下载地址，请稍后重试。' : '当前离线，联网后可获取最新下载地址。'
    } finally {
      nativeDownload.loading = false
      pending = undefined
    }
  }
  pending = work()
  return pending
}
