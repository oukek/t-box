import type { LifecycleAction, MarketEntry } from '@t-box/app-contracts'
import type { DeepReadonly } from 'vue'
import { reactive } from 'vue'
import {
  applicationModules,
  syncCatalogModules,
} from '../../applications/registry'
import { request } from '../network'
import { identity } from '../session'
import { clearApplicationBindings } from './resourceBindings'

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
  const epoch = ++generation
  const user = identity.user?.id
  const token = identity.token
  if (catalogUser !== user) {
    catalogUser = user
    appCatalog.entries = []
    appCatalog.error = ''
    appCatalog.stale = false
    appCatalog.revision++
  }
  if (!user) {
    appCatalog.entries = []
    appCatalog.loading = false
    appCatalog.error = ''
    appCatalog.stale = false
    appCatalog.revision++
    return
  }
  if (!options.silent) {
    appCatalog.loading = true
    appCatalog.error = ''
  }
  try {
    const result = await request<{ data: MarketEntry[] }>('/app-market')
    if (epoch === generation && identity.user?.id === user && identity.token === token) {
      if (JSON.stringify(appCatalog.entries) !== JSON.stringify(result.data)) {
        syncCatalogModules(result.data)
        appCatalog.entries = result.data
        appCatalog.revision++
        window.dispatchEvent(new Event('tbox:applications-changed'))
      }
      appCatalog.error = ''
      appCatalog.stale = false
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
  return appCatalog.entries.some(
    (e) => e.release.appId === appId && e.installation?.status === 'active',
  )
}
export async function repairInstallation(appId: string) {
  await request(`/app-market/${encodeURIComponent(appId)}/repair`, { method: 'POST', body: '{}' })
  await refreshCatalog()
  window.dispatchEvent(new Event('tbox:applications-changed'))
}
export async function changeInstallation(
  entry: DeepReadonly<MarketEntry>,
  action: LifecycleAction,
  key = crypto.randomUUID(),
) {
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
