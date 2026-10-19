import type { DeviceResourceState } from '@t-box/app-contracts'
import type { ApplicationPackage, JournalStorage, ResourceAdapter, ResourceProgress } from './contracts'
import { ErrorCode } from '../../../error-codes'

export function applicationPackage(value: { appId: string, releaseId: string, entryUrl: string, integrity?: string }): ApplicationPackage | undefined {
  const digest = value.integrity?.replace(/^sha256-/, '')
  if (!digest || /^0{64}$/.test(digest)) {
    return
  }
  const url = new URL(value.entryUrl)
  if (!/^[a-z][\w-]{0,63}$/.test(value.appId) || !/^[a-f0-9]{64}$/.test(digest) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(`/${value.appId}/${digest}/`)) {
    throw ErrorCode.INTERNAL_INVALID_APPLICATION_PACKAGE()
  }
  return { appId: value.appId, releaseId: value.releaseId, entryUrl: url.href, digest }
}

/** Public static resources are device scoped; healthy bindings are isolated by authenticated subject. */
export class ApplicationResourceManager {
  private preparing = new Map<string, Promise<'ready' | 'unsupported'>>()
  private listeners = new Map<string, Set<(value: ResourceProgress) => void>>()
  constructor(readonly adapter: ResourceAdapter, readonly storage: JournalStorage, readonly notify: (pkg: ApplicationPackage, state: DeviceResourceState) => void = () => {}) {}
  journal() {
    return this.storage.read() ?? { prepared: [], healthy: {}, quarantined: [] }
  }

  prepare(pkg: ApplicationPackage, progress?: (value: ResourceProgress) => void) {
    const key = pkg.entryUrl
    let listeners = this.listeners.get(key)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(key, listeners)
    }
    if (progress) {
      listeners.add(progress)
    }
    const pending = this.preparing.get(key)
    if (pending) {
      return pending
    }
    this.notify(pkg, { status: 'preparing' })
    const task = this.adapter.prepare(pkg, (value) => {
      this.notify(pkg, { status: 'preparing', completed: value.completed, total: value.total })
      for (const listener of this.listeners.get(key) ?? []) {
        listener(value)
      }
    }).then((state) => {
      this.notify(pkg, { status: state })
      if (state === 'ready') {
        const journal = this.journal()
        journal.prepared = [...journal.prepared.filter((p) => p.entryUrl !== key), pkg].slice(-64)
        this.storage.write(journal)
      }
      return state
    }).catch((error) => {
      this.notify(pkg, { status: 'failed' })
      throw error
    }).finally(() => {
      this.preparing.delete(key)
      this.listeners.delete(key)
    })
    this.preparing.set(key, task)
    return task
  }

  async open(pkg: ApplicationPackage, progress?: (value: ResourceProgress) => void) {
    if (this.journal().quarantined.includes(pkg.entryUrl)) {
      throw ErrorCode.INTERNAL_APPLICATION_VERSION_QUARANTINED()
    }
    // Adapter always checks the real completion marker. Browser eviction cannot leave a false "installed" flag.
    const state = await this.prepare(pkg, progress)
    return state === 'ready'
      ? this.adapter.open(pkg)
      : { entryUrl: pkg.entryUrl, origin: new URL(pkg.entryUrl).origin, source: 'network' as const }
  }

  healthy(subject: string, pkg: ApplicationPackage) {
    const journal = this.journal()
    const key = `${subject}:${pkg.appId}`
    const previous = journal.healthy[key]
    journal.healthy[key] = {
      current: pkg,
      previous: previous?.current.releaseId === pkg.releaseId ? previous.previous : previous?.current,
    }
    journal.healthy = Object.fromEntries(Object.entries(journal.healthy).slice(-128))
    journal.quarantined = journal.quarantined.filter((entry) => entry !== pkg.entryUrl)
    this.storage.write(journal)
    const previousDigest = journal.healthy[key]?.previous?.digest
    const update = journal.prepared.filter((p) => p.appId === pkg.appId && p.digest !== pkg.digest && p.digest !== previousDigest).at(-1)
    const keep = new Set([pkg.digest, previousDigest, update?.digest])
    for (const old of journal.prepared.filter((p) => p.appId === pkg.appId && !keep.has(p.digest))) {
      void this.adapter.remove(old).then(() => {
        const current = this.journal()
        current.prepared = current.prepared.filter((p) => p.entryUrl !== old.entryUrl)
        this.storage.write(current)
      }).catch(() => {})
    }
  }

  fallback(subject: string, appId: string, failedReleaseId: string) {
    const healthy = this.journal().healthy[`${subject}:${appId}`]
    return healthy?.current.releaseId === failedReleaseId ? healthy.previous : healthy?.current
  }

  quarantine(pkg: ApplicationPackage) {
    this.notify(pkg, { status: 'failed' })
    const journal = this.journal()
    journal.quarantined = [...new Set([...journal.quarantined, pkg.entryUrl])].slice(-128)
    this.storage.write(journal)
  }

  async repair(pkg: ApplicationPackage) {
    await this.adapter.remove(pkg)
    const journal = this.journal()
    journal.quarantined = journal.quarantined.filter((entry) => entry !== pkg.entryUrl)
    journal.prepared = journal.prepared.filter((entry) => entry.entryUrl !== pkg.entryUrl)
    this.storage.write(journal)
    return this.prepare(pkg)
  }
}
