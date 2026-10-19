import type { AppRelease } from '@t-box/app-contracts'
import { validateRelease } from '@t-box/app-contracts'
import { ErrorCode } from '../../error-codes'

export const publicLocalCatalogKey = 'tbox.public-local-applications.v1'
/** A cached public catalog is UI metadata, never an account, installation, or backend authorization. */
export function parsePublicLocalCatalog(value: unknown, allowed: ReadonlySet<string>, hostOrigin: string, development = false): AppRelease[] {
  const index = value as { protocol?: unknown, applications?: AppRelease[] } | null
  if (!index || index.protocol !== 1 || !Array.isArray(index.applications) || index.applications.length > 64) {
    throw ErrorCode.INTERNAL_INVALID_LOCAL_APPLICATIONS()
  }
  const ids = new Set<string>()
  return index.applications.map((release) => {
    validateRelease(release)
    if (!allowed.has(release.appId) || release.guestAccess !== 'local' || release.kind !== 'system' || !release.defaultInstalled || !release.platforms.includes('web') || release.runtime.type !== 'web' || ids.has(release.appId)) {
      throw ErrorCode.INTERNAL_INVALID_LOCAL_APPLICATIONS()
    }
    const url = new URL(release.runtime.entryUrl)
    const digest = release.runtime.integrity.slice(7)
    const devUrl = development && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /^0{64}$/.test(digest)
    if (url.origin === hostOrigin || url.origin === 'https://bundled.tbox.invalid' || url.search || (!devUrl && (/^0{64}$/.test(digest) || url.pathname !== `/${release.appId}/${digest}/`))) {
      throw ErrorCode.INTERNAL_INVALID_LOCAL_APPLICATIONS()
    }
    ids.add(release.appId)
    return { ...release, backend: { type: 'none', binding: '' }, permissions: release.permissions.includes('storage') ? ['storage'] : [], manifest: { ...release.manifest, skillIds: [] } }
  })
}
