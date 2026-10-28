import type { AppUser } from '@t-box/shared'
import { request, RequestError } from '../../core/network'
import {
  identity,
  restoreError,
  restoreIdentity,
  restoreLocalIdentity,
  setSession,
} from '../../core/session'
import { suppressAutomaticWechatLogin } from './wechatLogin'

let restoring: { token: string, promise: Promise<void> } | undefined
let retry: ReturnType<typeof setTimeout> | undefined
async function attemptRestore(attempt = 0): Promise<void> {
  const token = identity.token
  if (!token) {
    restoreIdentity(null)
    return
  }
  // Paint the previously used account's local apps immediately; verification runs separately.
  const hasLocalIdentity = restoreLocalIdentity()
  try {
    const result = await request<{ data: AppUser }>('/auth/me', { timeoutMs: hasLocalIdentity ? 4000 : 15000 })
    if (identity.token === token) {
      restoreIdentity(result.data)
    }
  } catch (cause) {
    if (identity.token !== token) {
      return
    }
    if (cause instanceof RequestError && [401, 403].includes(cause.status)) {
      restoreIdentity(null)
    } else {
      if (!hasLocalIdentity) {
        restoreError(cause instanceof Error ? cause.message : '账号服务暂时不可用')
      }
      if (navigator.onLine && attempt < 5) {
        retry = setTimeout(() => {
          if (identity.token === token && identity.verification !== 'verified') {
            void attemptRestore(attempt + 1)
          }
        }, 1000 * 2 ** attempt)
      }
    }
  }
}
export function restoreSession(): Promise<void> {
  clearTimeout(retry)
  if (restoring?.token === identity.token) {
    return restoring.promise
  }
  const active = { token: identity.token, promise: attemptRestore() }
  restoring = active
  void active.promise.finally(() => {
    if (restoring === active) {
      restoring = undefined
    }
  })
  return active.promise
}
window.addEventListener('online', () => {
  if (!identity.ready || identity.verification !== 'verified') {
    void restoreSession()
  }
})
window.addEventListener('offline', () => {
  if (identity.token) {
    restoreLocalIdentity()
  }
})
export async function logout() {
  suppressAutomaticWechatLogin()
  try {
    await request('/auth/session', { method: 'DELETE' })
  } finally {
    setSession(null)
  }
}
export async function updateNickname(nickname: string) {
  const { data } = await request<{ data: AppUser }>('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ nickname }),
  })
  restoreIdentity(data)
}
export async function updateAvatar(file: File | null) {
  if (file && (!file.size || file.size > 2 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
    throw new Error('请选择不超过 2 MB 的 JPG、PNG 或 WebP 图片')
  }
  const { data } = await request<{ data: AppUser }>('/auth/avatar', file ? { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' }, timeoutMs: 60_000 } : { method: 'DELETE' })
  restoreIdentity(data)
}
