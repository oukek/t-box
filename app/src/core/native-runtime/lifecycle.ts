import { Capacitor } from '@capacitor/core'
import { watch } from 'vue'
import { applicationModules } from '../../applications/registry'
import { waitForApplicationRuntime } from '../app-runtime/bridge'
import { appCatalog, isInstalled } from '../app-runtime/catalog'
import { localApplications } from '../app-runtime/localApplications'
import { openApplication } from '../navigation'
import { apiBase, request } from '../network'
import { identity } from '../session'
import { nativeDevice } from './adapter'

/** Native requests survive cold starts. Opening a screen never fabricates a successful business write. */
export function startNativeRuntime() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
    return () => {}
  }
  let disposed = false
  const lifetime = new AbortController()
  let processing = false
  let syncing: Promise<void> | undefined
  let dirty = false
  let generation = 0
  let removeListener: (() => Promise<void>) | undefined
  const process = async () => {
    if (disposed || processing || !identity.ready) {
      return
    }
    processing = true
    try {
      const plugin = await nativeDevice()
      const { requests } = await plugin.pending()
      for (const item of requests) {
        if (disposed) {
          return
        }
        if (item.subject && item.subject !== identity.user?.id) {
          continue
        }
        if (!isInstalled(item.appId) || !applicationModules.some((module) => module.manifest.id === item.appId)) {
          continue
        }
        if (!identity.user && !localApplications.releases.some((release) => release.appId === item.appId)) {
          continue
        }
        await openApplication({ appId: item.appId, params: item.params })
        if (appCatalog.entries.find((entry) => entry.release.appId === item.appId)?.release.runtime.type === 'web' || localApplications.releases.some((release) => release.appId === item.appId)) {
          await waitForApplicationRuntime(item.appId, lifetime.signal)
        }
        if (disposed) {
          return
        }
        await plugin.acknowledge({ id: item.id })
        // One request at a time: do not immediately replace the screen another intent just opened.
        break
      }
    } catch { /* Keep the durable request for the next foreground attempt. */ } finally {
      processing = false
    }
  }
  const sync = () => {
    if (disposed) {
      return
    }
    if (syncing) {
      dirty = true
      return
    }
    const started = generation
    syncing = (async () => {
      const plugin = await nativeDevice()
      if (disposed || !identity.ready) {
        return
      }
      const guest = new Set(localApplications.releases.map((release) => release.appId))
      const installed = new Map(appCatalog.entries.filter((entry) => entry.installation?.status === 'active').map((entry) => [entry.release.appId, (entry.installedRelease ?? entry.release).manifest.name]))
      for (const release of localApplications.releases) {
        installed.set(release.appId, release.manifest.name)
      }
      if (appCatalog.marketHidden) {
        installed.delete('market')
      }
      await plugin.configureApplications({ applications: [...installed].map(([appId, name]) => ({ appId, name, guest: guest.has(appId) })) })
      const user = identity.user?.id
      const token = identity.token
      if (!user || !token) {
        await plugin.clearSession()
        return
      }
      if (identity.verification !== 'verified' || !navigator.onLine) {
        return
      }
      const parent = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      const status = await plugin.sessionStatus()
      if (status.subject === user && status.parent === parent) {
        return
      }
      const result = await request<{ data: { token: string, subject: string } }>('/native/session', { method: 'POST', body: '{}' })
      if (disposed || started !== generation || identity.token !== token || identity.user?.id !== user) {
        return
      }
      await plugin.setSession({ ...result.data, apiBase: new URL(apiBase, location.href).href.replace(/\/$/, '') })
    })().catch(() => { /* Native/online failure must never block opening local applications. */ }).finally(() => {
      syncing = undefined
      if (dirty) {
        dirty = false
        sync()
      }
      void process()
    })
  }
  const stop = watch([() => identity.user?.id, () => identity.token, () => identity.ready, () => identity.verification, () => appCatalog.revision, () => appCatalog.marketHidden, () => localApplications.releases], () => {
    generation++
    sync()
  }, { immediate: true })
  void nativeDevice().then(async (plugin) => {
    const listener = await plugin.addListener('openRequest', () => {
      void process()
    })
    if (disposed) {
      await listener.remove()
    } else {
      removeListener = () => listener.remove()
    }
  }).catch(() => {})
  const foreground = () => {
    if (document.visibilityState === 'visible') {
      sync()
      void process()
    }
  }
  document.addEventListener('visibilitychange', foreground)
  window.addEventListener('online', foreground)
  return () => {
    disposed = true
    lifetime.abort()
    generation++
    stop()
    void removeListener?.()
    document.removeEventListener('visibilitychange', foreground)
    window.removeEventListener('online', foreground)
  }
}
