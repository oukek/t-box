import type { ApplicationContext, AppPlatform, AppRelease, MarketEntry, RuntimeDescriptor } from '@t-box/app-contracts'
import { validateRelease } from '@t-box/app-contracts'
import { shallowReactive } from 'vue'
import { ErrorCode } from '../../error-codes'
import { deviceApplicationScope } from './deviceStorage'
import { resolveLocalLaunch } from './localLaunch'
import { parsePublicLocalCatalog, publicLocalCatalogKey } from './publicLocalCatalog'

export const localApplications = shallowReactive({ releases: [] as AppRelease[], error: '' })
let allowed = new Set<string>()
let refresh: Promise<void> | undefined
let refreshedAt = 0
let nativeIndex = false
const previousReleases = new Map<string, AppRelease>()
function savePublicCatalog() {
  try {
    localStorage.setItem(publicLocalCatalogKey, JSON.stringify({ protocol: 1, applications: localApplications.releases }))
  } catch { /* Storage denial affects offline persistence only. */ }
}
/** Refresh only public static metadata. An unavailable update never replaces a previously cached version. */
export function refreshLocalApplications() {
  if (nativeIndex || import.meta.env.DEV || !navigator.onLine || !allowed.size || Date.now() - refreshedAt < 60_000) {
    return Promise.resolve()
  }
  if (refresh) {
    return refresh
  }
  refreshedAt = Date.now()
  refresh = (async () => {
    try {
      const { apiBase } = await import('../network')
      const response = await fetch(`${apiBase}/app-market/local`, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(4000) })
      if (!response.ok) {
        return
      }
      const incoming = parsePublicLocalCatalog(await response.json(), allowed, location.origin)
      const previous = localApplications.releases
      const next: AppRelease[] = []
      for (const release of incoming) {
        const old = previous.find((entry) => entry.appId === release.appId)
        if (old && old.releaseId !== release.releaseId) {
          try {
            const { prepareRelease } = await import('./resources')
            if (await prepareRelease(release) !== 'ready') {
              next.push(old)
              continue
            }
          } catch {
            next.push(old)
            continue
          }
        }
        next.push(release)
      }
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        for (const release of previous) {
          previousReleases.set(release.releaseId, release)
        }
        while (previousReleases.size > 128) {
          previousReleases.delete(previousReleases.keys().next().value!)
        }
        localApplications.releases = next
        savePublicCatalog()
      }
    } catch { /* Offline, timeout, and invalid metadata preserve the last usable public catalog. */ }
  })().finally(() => {
    refresh = undefined
  })
  return refresh
}
export function parseBundledApplications(value: unknown): AppRelease[] {
  const index = value as { protocol?: unknown, applications?: AppRelease[] } | null
  if (!index || index.protocol !== 1 || !Array.isArray(index.applications) || !index.applications.length || index.applications.length > 64) {
    throw ErrorCode.INTERNAL_INVALID_NATIVE_BUNDLES()
  }
  const ids = new Set<string>()
  for (const release of index.applications) {
    validateRelease(release)
    if (release.kind !== 'system' || !release.defaultInstalled || release.runtime.type !== 'web' || !release.platforms.includes('android') || !release.platforms.includes('ios') || ids.has(release.appId)) {
      throw ErrorCode.INTERNAL_INVALID_NATIVE_BUNDLES()
    }
    const url = new URL(release.runtime.entryUrl)
    if (url.origin !== 'https://bundled.tbox.invalid' || url.pathname !== `/${release.appId}/${release.runtime.integrity.slice(7)}/`) {
      throw ErrorCode.INTERNAL_INVALID_NATIVE_BUNDLES()
    }
    ids.add(release.appId)
  }
  return index.applications
}
/** Native uses the signed bundle index; web uses app-owned eligibility plus a public, isolated release catalog. */
export async function loadLocalApplications() {
  nativeIndex = !!window.Capacitor?.isNativePlatform?.() && !import.meta.env.DEV
  if (!nativeIndex) {
    const declarations = (await import('virtual:tbox-local-applications')).default
    allowed = new Set(declarations.map((release) => release.appId))
    if (import.meta.env.DEV) {
      localApplications.releases = parsePublicLocalCatalog({ protocol: 1, applications: declarations }, allowed, location.origin, true)
      return
    }
    try {
      const raw = localStorage.getItem(publicLocalCatalogKey)
      if (raw && raw.length <= 6_000_000) {
        localApplications.releases = parsePublicLocalCatalog(JSON.parse(raw), allowed, location.origin)
      }
    } catch { /* Corrupt metadata never blocks the login screen or grants access. */ }
    if (localApplications.releases.length) {
      void refreshLocalApplications()
    } else {
      await refreshLocalApplications()
    }
    return
  }
  try {
    const response = await fetch(new URL('tbox-bundled-applications.json', document.baseURI), { credentials: 'omit', signal: AbortSignal.timeout(4000) })
    if (!response.ok) {
      throw ErrorCode.INTERNAL_INVALID_NATIVE_BUNDLES()
    }
    localApplications.releases = parseBundledApplications(await response.json())
  } catch (error) {
    localApplications.error = error instanceof Error ? error.message : '内置应用准备失败'
  }
}
export function localEntries(userId?: string, entries: readonly MarketEntry[] = []): MarketEntry[] {
  return localApplications.releases.map((release) => ({
    release,
    installedRelease: release,
    localOnly: true,
    installation: { appId: release.appId, releaseId: release.releaseId, generation: 1, status: 'active', targetReleaseId: null, operationId: null, grants: [] },
    localBinding: {
      subject: deviceApplicationScope(release.appId, userId, entries.find((entry) => entry.release.appId === release.appId)?.localBinding?.subject),
      storage: release.permissions.includes('storage'),
    },
  }))
}
export function mergeLocalEntries(entries: readonly MarketEntry[], userId?: string) {
  return [...entries, ...localEntries(userId, entries).filter((fallback) => !entries.some((entry) => entry.release.appId === fallback.release.appId))]
}
export function localBaselineLaunch(appId: string, platform: AppPlatform, userId?: string, entries: readonly MarketEntry[] = []) {
  return resolveLocalLaunch(localEntries(userId, entries), appId, platform)
}
export function localBaselineContext(appId: string, expected: Pick<RuntimeDescriptor, 'releaseId' | 'generation' | 'subject'>, platform: AppPlatform): ApplicationContext | undefined {
  let entry = localEntries().find((entry) => entry.release.appId === appId && entry.release.releaseId === expected.releaseId)
  const previous = previousReleases.get(expected.releaseId)
  if (!entry && previous?.appId === appId) {
    entry = { release: previous, installedRelease: previous, localOnly: true, installation: { appId, releaseId: previous.releaseId, generation: 1, status: 'active', targetReleaseId: null, operationId: null, grants: [] }, localBinding: { subject: expected.subject, storage: previous.permissions.includes('storage') } }
  }
  if (!entry || entry.installation?.generation !== expected.generation || !/^[a-f0-9]{64}$/.test(expected.subject)) {
    return
  }
  entry.localBinding!.subject = expected.subject
  return resolveLocalLaunch([entry], appId, platform)?.context
}
