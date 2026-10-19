import type { AppUser, UserSession } from '@t-box/shared'
import { reactive, readonly } from 'vue'
import { clearLocalAccount, readLocalProfile, saveLocalProfile } from './localAccount'

const storageKey = 'tbox.identity.v1'
const state = reactive({
  token: '',
  user: null as AppUser | null,
  ready: false,
  error: '',
  verification: 'local' as 'local' | 'verified',
})
try {
  state.token = localStorage.getItem(storageKey) || ''
} catch {
  /* memory fallback */
}
export const identity = readonly(state)
export function restoreError(message: string) {
  state.error = message
  state.ready = false
}
export function setSession(session: UserSession | null) {
  if (!session || (state.user && state.user.id !== session.user.id)) {
    clearLocalAccount(state.user?.id)
  }
  state.token = session?.token ?? ''
  state.user = session?.user ?? null
  state.ready = true
  state.error = ''
  state.verification = session ? 'verified' : 'local'
  if (session) {
    saveLocalProfile(session.user)
  }
  try {
    if (session) {
      localStorage.setItem(storageKey, session.token)
    } else {
      localStorage.removeItem(storageKey)
    }
  } catch {
    /* memory fallback */
  }
}
export function restoreIdentity(user: AppUser | null) {
  if (state.user && user && state.user.id !== user.id) {
    clearLocalAccount(state.user.id)
  }
  state.user = user
  state.ready = true
  state.error = ''
  state.verification = user ? 'verified' : 'local'
  if (user) {
    saveLocalProfile(user)
  }
  if (!user) {
    setSession(null)
  }
}
/** Resume device-local UI without treating the cached account as server authentication. */
export function restoreLocalIdentity() {
  const user = state.token ? (state.user ?? readLocalProfile()) : null
  if (!user) {
    return false
  }
  state.user = user
  state.ready = true
  state.error = ''
  state.verification = 'local'
  return true
}
