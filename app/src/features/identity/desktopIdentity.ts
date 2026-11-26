import { watch } from 'vue'
import { apiBase } from '../../core/network'
import { identity } from '../../core/session'

/** Sync only the trusted native shell; loopback HTTP never exposes this credential. */
export function installDesktopIdentity() {
  if (!window.__TBOX_DESKTOP_KEY__) {
    return
  }
  let pending = Promise.resolve()
  watch(() => [identity.token, identity.verification, identity.user?.id], () => {
    const token = identity.verification === 'verified' && identity.user ? identity.token : ''
    pending = pending.then(async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('desktop_login_identity', { key: window.__TBOX_DESKTOP_KEY__, token, api: apiBase })
    }).catch(() => { /* Older cores have no bridge; normal Mac login remains available. */ })
  }, { immediate: true, flush: 'sync' })
}
