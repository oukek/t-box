import type { Session } from '../core/types'
import { emptySession } from '../core/session'

export const extension = typeof chrome !== 'undefined' && !!chrome.runtime?.id
let preview = emptySession()
export async function request<T>(
  action: string,
  extra: Record<string, unknown> = {},
): Promise<T> {
  if (!extension) {
    if (action === 'session') {
      return preview as T
    }
    if (action === 'remove') {
      preview = {
        ...preview,
        products: preview.products.filter(
          (p) => !(extra.ids as string[]).includes(p.id),
        ),
      }
      return true as T
    }
    throw new Error('请在 Chrome 中加载插件后操作；此页面仅用于界面预览')
  }
  const result = await chrome.runtime.sendMessage({ action, ...extra })
  if (!result?.ok) {
    throw new Error(result?.error || '插件未响应，请刷新后重试')
  }
  return result.data as T
}
export const getSession = () => request<Session>('session')
export function subscribe(callback: () => void) {
  if (!extension) {
    return () => {}
  }
  const listener = (
    _changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === 'session') {
      callback()
    }
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
