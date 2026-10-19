import type { AppRelease, DeviceResourceState } from '@t-box/app-contracts'
import type { ResourceJournal } from './contracts'
import { reactive } from 'vue'
import { applicationPackage, ApplicationResourceManager } from './manager'
import { NativeResourceAdapter } from './native'
import { WebResourceAdapter } from './web'

let memory: ResourceJournal | undefined
const storageKey = 'tbox.application-resources.v1'
export const deviceResources = reactive<Record<string, DeviceResourceState>>({})
function validPackage(value: unknown): value is ResourceJournal['prepared'][number] {
  if (!value || typeof value !== 'object') {
    return false
  }
  const p = value as ResourceJournal['prepared'][number]
  if (typeof p.appId !== 'string' || typeof p.releaseId !== 'string' || p.releaseId.length > 100 || typeof p.digest !== 'string' || typeof p.entryUrl !== 'string') {
    return false
  }
  try {
    return !!applicationPackage({ ...p, integrity: `sha256-${p.digest}` })
  } catch {
    return false
  }
}
export const applicationResources = new ApplicationResourceManager(
  window.Capacitor?.isNativePlatform?.() ? new NativeResourceAdapter() : new WebResourceAdapter(),
  {
    read() {
      try {
        const value = JSON.parse(localStorage.getItem(storageKey) || 'null') as ResourceJournal | null
        if (value && Array.isArray(value.prepared) && Array.isArray(value.quarantined) && value.healthy && typeof value.healthy === 'object') {
          return {
            prepared: value.prepared.filter(validPackage).slice(-64),
            quarantined: value.quarantined.filter((entry) => typeof entry === 'string' && entry.length <= 2048).slice(-128),
            healthy: Object.fromEntries(Object.entries(value.healthy).filter(([key, entry]) => key.length <= 256 && entry && validPackage(entry.current) && (!entry.previous || validPackage(entry.previous))).slice(-128)),
          }
        }
      } catch { /* Storage denial must not block public resource loading. */ }
      return memory
    },
    write(value) {
      memory = value
      try {
        localStorage.setItem(storageKey, JSON.stringify(value))
      } catch { /* The native package completion marker remains authoritative. */ }
    },
  },
  (pkg, state) => {
    deviceResources[pkg.releaseId] = state
  },
)
type ResourceRelease = Readonly<Pick<AppRelease, 'appId' | 'releaseId' | 'runtime'>>
export async function prepareRelease(release: ResourceRelease, repairQuarantined = false) {
  if (release.runtime.type !== 'web') {
    return
  }
  const pkg = applicationPackage({ ...release, ...release.runtime })
  if (pkg) {
    if (applicationResources.journal().quarantined.includes(pkg.entryUrl)) {
      if (repairQuarantined) {
        await applicationResources.repair(pkg)
      }
      return
    }
    return applicationResources.prepare(pkg)
  }
}
// Static packages only: no backend activation, permission changes, or hot replacement of a running app.
let prefetching = false
let pending: readonly ResourceRelease[] = []
const prefetched = new Map<string, number>()
const failures = new Map<string, { attempts: number, nextAt: number }>()
export function prefetchReleases(releases: readonly ResourceRelease[]) {
  pending = releases
  if (prefetching || !navigator.onLine) {
    return
  }
  prefetching = true
  void (async () => {
    try {
      while (pending.length && navigator.onLine) {
        const batch = pending
        pending = []
        for (const release of batch) {
          if ((prefetched.get(release.releaseId) || 0) > Date.now() - 300_000 || (failures.get(release.releaseId)?.nextAt || 0) > Date.now()) {
            continue
          }
          try {
            await prepareRelease(release)
            prefetched.set(release.releaseId, Date.now())
            failures.delete(release.releaseId)
            if (prefetched.size > 256) {
              prefetched.delete(prefetched.keys().next().value!)
            }
          } catch {
            const attempts = (failures.get(release.releaseId)?.attempts || 0) + 1
            failures.set(release.releaseId, { attempts, nextAt: Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(attempts - 1, 4)) })
            if (failures.size > 256) {
              failures.delete(failures.keys().next().value!)
            }
          }
        }
      }
    } finally {
      prefetching = false
    }
  })()
}
