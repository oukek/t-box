import type { AppUser, UserSession } from '@t-box/shared'
import { request, RequestError } from '../../core/network'
import {
  identity,
  restoreError,
  restoreIdentity,
  restoreLocalIdentity,
  setSession,
} from '../../core/session'

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
export async function authenticate(
  mode: 'login' | 'register',
  input: { username: string, password: string, nickname?: string },
) {
  const { data } = await request<{ data: UserSession }>(`/auth/${mode}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  setSession(data)
}
export async function recoverPassword(input: { username: string, recoveryCode: string, newPassword: string }) {
  await request('/auth/password-recovery', { method: 'POST', body: JSON.stringify(input) })
}
export async function logout() {
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
