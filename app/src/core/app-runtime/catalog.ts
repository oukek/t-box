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
})
let generation = 0
export async function refreshCatalog() {
  const epoch = ++generation
  const user = identity.user?.id
  if (!user) {
    appCatalog.entries = []
    return
  }
  appCatalog.loading = true
  appCatalog.error = ''
  try {
    const result = await request<{ data: MarketEntry[] }>('/app-market')
    if (epoch === generation && identity.user?.id === user) {
      syncCatalogModules(result.data)
      appCatalog.entries = result.data
      appCatalog.revision++
      for (const module of applicationModules) {
        if (!isInstalled(module.manifest.id)) {
          clearApplicationBindings(module.manifest.id)
        }
      }
    }
  } catch (e) {
    if (epoch === generation) {
      appCatalog.error = e instanceof Error ? e.message : '应用市场读取失败'
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
