import type { AppUser } from '@t-box/shared'
import { request } from '../../core/network'
import { identity } from '../../core/session'

export function installCollectorBridge() {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'tbox.collector.account' || typeof event.data.id !== 'string' || event.data.id.length > 64) {
      return
    }
    const id = event.data.id
    void (async () => {
      let user: Pick<AppUser, 'id' | 'nickname' | 'avatarUrl'> | null = null
      if (identity.token) {
        try {
          const result = await request<{ data: AppUser }>('/auth/me', { timeoutMs: 4000 })
          user = { id: result.data.id, nickname: result.data.nickname, avatarUrl: result.data.avatarUrl }
        } catch { /* Cached profiles are not proof of a valid session. */ }
      }
      window.postMessage({ type: 'tbox.collector.account.result', id, user }, location.origin)
    })()
  })
}
