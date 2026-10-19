import type { AppRelease } from '@t-box/app-contracts'
import { validateRelease } from '@t-box/app-contracts'

/** Public metadata only. Guest eligibility belongs to trusted app declarations, never an administrator form. */
export function publicLocalReleases(releases: readonly AppRelease[], allowed: ReadonlySet<string>, development = false): AppRelease[] {
  return releases.flatMap((release) => {
    try {
      validateRelease(release)
      if (!allowed.has(release.appId) || release.guestAccess !== 'local' || release.kind !== 'system' || !release.defaultInstalled || !release.platforms.includes('web') || release.runtime.type !== 'web') {
        return []
      }
      const url = new URL(release.runtime.entryUrl)
      const digest = release.runtime.integrity.slice(7)
      const developmentEntry = development && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /^0{64}$/.test(digest)
      if (!developmentEntry && (/^0{64}$/.test(digest) || url.protocol !== 'https:' || url.pathname !== `/${release.appId}/${digest}/` || url.search)) {
        return []
      }
      return [{
        ...release,
        guestAccess: 'local' as const,
        manifest: { ...release.manifest, skillIds: [] },
        backend: { type: 'none' as const, binding: '' },
        permissions: release.permissions.includes('storage') ? ['storage'] : [],
      }]
    } catch {
      return []
    }
  })
}
