import type { RuntimeDescriptor } from '@t-box/app-contracts'
import type { ApplicationResourceManager } from './manager'
import { applicationPackage } from './manager'

/** Coordinates static fallback with server lifecycle authorization. It never substitutes an old page on its own. */
export class LaunchRecovery {
  private attempted = new Set<string>()
  constructor(readonly resources: ApplicationResourceManager) {}
  async recover(runtime: RuntimeDescriptor, ports: {
    current(): boolean
    rollback(failedReleaseId: string, releaseId: string): Promise<{ status: string }>
    started(): void
  }) {
    const previous = this.resources.fallback(runtime.subject, runtime.appId, runtime.releaseId)
    if (!previous || this.resources.journal().quarantined.includes(previous.entryUrl) || this.attempted.has(runtime.releaseId) || !ports.current()) {
      return false
    }
    this.attempted.add(runtime.releaseId)
    ports.started()
    await this.resources.prepare(previous)
    // Downloads can outlive navigation/logout. Never commit a mutation for the next account or a stale opening.
    if (!ports.current()) {
      return false
    }
    const result = await ports.rollback(runtime.releaseId, previous.releaseId)
    if (!ports.current() || result.status !== 'completed') {
      return false
    }
    const failed = applicationPackage(runtime)
    if (failed) {
      this.resources.quarantine(failed)
    }
    return true
  }
}
