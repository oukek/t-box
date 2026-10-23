import type { ApplicationContext, AppPlatform, HostMethod, MarketEntry, RuntimeDescriptor } from '@t-box/app-contracts'
import { APP_PROTOCOL, APP_SDK_VERSION, validateRelease } from '@t-box/app-contracts'
import { localCatalogKey } from '../localAccount'

const baseMethods: readonly HostMethod[] = ['runtime.context', 'auth.session', 'navigation.back', 'navigation.open']
const storageMethods: readonly HostMethod[] = ['storage.get', 'storage.set', 'storage.remove']
/** This allowlist is host policy, independent of any application's business logic. */
export function isLocalMethod(method: HostMethod) {
  return (method.startsWith('device.') && method !== 'device.reminders') || baseMethods.includes(method) || storageMethods.includes(method)
}
export function resolveLocalLaunch(entries: readonly MarketEntry[], appId: string, platform: AppPlatform) {
  const entry = entries.find((item) => item.release.appId === appId)
  const installed = entry?.installation
  const release = entry?.installedRelease ?? entry?.release
  const binding = entry?.localBinding
  if (!release || !installed || installed.status !== 'active' || release.releaseId !== installed.releaseId || installed.appId !== appId || !Number.isSafeInteger(installed.generation) || installed.generation < 1 || !release.platforms.includes(platform) || !binding || !/^[a-f0-9]{64}$/.test(binding.subject) || typeof binding.storage !== 'boolean') {
    return undefined
  }
  validateRelease(release)
  const context: ApplicationContext = {
    sdkVersion: APP_SDK_VERSION,
    appId,
    releaseId: installed.releaseId,
    applicationVersion: release.manifest.version,
    generation: installed.generation,
    subject: binding.subject,
    platform,
    runtime: release.runtime.type,
    params: {},
    access: 'local',
    permissions: release.permissions.filter((permission) => permission.startsWith('device.') && permission !== 'device.reminders'),
    capabilities: [...baseMethods, ...(binding.storage ? storageMethods : [])],
  }
  const descriptor: RuntimeDescriptor | undefined = release.runtime.type === 'web'
    ? {
        protocol: APP_PROTOCOL,
        appId,
        releaseId: installed.releaseId,
        generation: installed.generation,
        subject: binding.subject,
        permissions: [],
        clientTools: release.clientTools,
        entryUrl: release.runtime.entryUrl,
        origin: new URL(release.runtime.entryUrl).origin,
        integrity: release.runtime.integrity,
        ...(entry?.localOnly ? { localOnly: true } : {}),
      }
    : undefined
  return { context, descriptor }
}
export function saveLocalCatalog(userId: string, entries: readonly MarketEntry[]) {
  try {
    // Backend grants are never restored from a device snapshot.
    const local = entries.filter((entry) => entry.installation?.status === 'active' && entry.localBinding).map((entry) => ({
      release: entry.release,
      installedRelease: entry.installedRelease,
      installation: { ...entry.installation!, grants: [], error: null },
      localBinding: entry.localBinding,
    }))
    localStorage.setItem(localCatalogKey(userId), JSON.stringify(local))
  } catch { /* Storage denial doesn't affect an online catalog. */ }
}
export function readLocalCatalog(userId: string): MarketEntry[] {
  try {
    const raw = localStorage.getItem(localCatalogKey(userId))
    if (!raw || raw.length > 6_000_000) {
      return []
    }
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value) || value.length > 256) {
      return []
    }
    return value.filter((entry: MarketEntry) => {
      try {
        validateRelease(entry.release)
        return !!resolveLocalLaunch([entry], entry.release.appId, entry.release.platforms[0]!)
      } catch {
        return false
      }
    }).map((entry: MarketEntry) => ({ ...entry, installation: { ...entry.installation!, grants: [] } }))
  } catch {
    return []
  }
}
