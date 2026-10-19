import type { LifecycleAction, MarketEntry } from '@t-box/app-contracts'
import type { DeepReadonly } from 'vue'
import { SdkErrorCode } from '@t-box/app-sdk'
import { reactive } from 'vue'
import {
  applicationModules,
  syncCatalogModules,
} from '../../applications/registry'
import { ErrorCode } from '../../error-codes'
import { request } from '../network'
import { identity } from '../session'
import { localApplications, mergeLocalEntries, refreshLocalApplications } from './localApplications'
import { readLocalCatalog, saveLocalCatalog } from './localLaunch'
import { clearApplicationBindings } from './resourceBindings'
import { prefetchReleases, prepareRelease } from './resources'

export const appCatalog = reactive({
  entries: [] as MarketEntry[],
  loading: false,
  error: '',
  revision: 0,
  stale: false,
})
let generation = 0
let catalogUser: string | undefined
export async function refreshCatalog(options: { silent?: boolean } = {}) {
  void refreshLocalApplications()
  const epoch = ++generation
  const user = identity.user?.id
  const token = identity.token
  if (catalogUser !== user) {
    catalogUser = user
    appCatalog.entries = mergeLocalEntries(user ? readLocalCatalog(user) : [], user)
    syncCatalogModules(appCatalog.entries)
    appCatalog.error = ''
    appCatalog.stale = !!appCatalog.entries.length
    appCatalog.revision++
  }
  if (!user) {
    appCatalog.entries = mergeLocalEntries([])
    appCatalog.loading = false
    appCatalog.error = ''
    appCatalog.stale = false
    appCatalog.revision++
    prefetchReleases(localApplications.releases)
    return
  }
  if (!options.silent) {
    appCatalog.loading = true
    appCatalog.error = ''
  }
  try {
    const result = await request<{ data: MarketEntry[] }>('/app-market')
    if (epoch === generation && identity.user?.id === user && identity.token === token) {
      const entries = mergeLocalEntries(result.data, user)
      if (JSON.stringify(appCatalog.entries) !== JSON.stringify(entries)) {
        syncCatalogModules(entries)
        appCatalog.entries = entries
        appCatalog.revision++
        window.dispatchEvent(new Event('tbox:applications-changed'))
      }
      appCatalog.error = ''
      appCatalog.stale = false
      saveLocalCatalog(user, result.data)
      prefetchReleases([...localApplications.releases, ...result.data.filter((entry) => entry.installation?.status === 'active').flatMap((entry) => [entry.installedRelease ?? entry.release, ...(entry.installation?.releaseId !== entry.release.releaseId ? [entry.release] : [])])])
      for (const module of applicationModules) {
        if (!isInstalled(module.manifest.id)) {
          clearApplicationBindings(module.manifest.id)
        }
      }
    }
  } catch (e) {
    if (epoch === generation) {
      appCatalog.stale = true
      if (!options.silent || !appCatalog.entries.length) {
        appCatalog.error = e instanceof Error ? e.message : '应用市场读取失败'
      }
    }
  } finally {
    if (epoch === generation) {
      appCatalog.loading = false
    }
  }
}
export function isInstalled(appId: string) {
  return localApplications.releases.some((release) => release.appId === appId) || appCatalog.entries.some(
    (e) => e.release.appId === appId && e.installation?.status === 'active',
  )
}
export async function repairInstallation(appId: string) {
  if (!navigator.onLine) {
    throw SdkErrorCode.NETWORK_REQUIRED()
  }
  await request(`/app-market/${encodeURIComponent(appId)}/repair`, { method: 'POST', body: '{}' })
  await refreshCatalog()
  window.dispatchEvent(new Event('tbox:applications-changed'))
}
export async function changeInstallation(
  entry: DeepReadonly<MarketEntry>,
  action: LifecycleAction,
  key = crypto.randomUUID(),
) {
  if (!navigator.onLine) {
    throw SdkErrorCode.NETWORK_REQUIRED()
  }
  const user = identity.user?.id
  const token = identity.token
  // Prepare the target before activating its backend version. A failed download leaves the installed version usable.
  if (action !== 'uninstall') {
    await prepareRelease(entry.release, true)
  }
  if (!user || identity.user?.id !== user || identity.token !== token) {
    throw ErrorCode.INTERNAL_APPLICATION_AUTHORIZATION_EXPIRED()
  }
  const result = await request<{
    data: { id: string, status: string, error: string | null }
  }>(`/app-market/${entry.release.appId}/operations`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({
      action,
      releaseId: entry.release.releaseId,
      hostVersion: applicationModules.find(
        (m) => m.manifest.id === entry.release.appId,
      )?.manifest.version,
      grants: action === 'uninstall' ? [] : entry.release.permissions,
    }),
  })
  await refreshCatalog()
  window.dispatchEvent(new Event('tbox:applications-changed'))
  return result.data
}
