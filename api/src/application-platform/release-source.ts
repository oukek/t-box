import type { AppRelease } from '@t-box/app-contracts'

/** A Vite preview is not an immutable build and must never pass publication checks. */
export function isDevelopmentRelease(release: AppRelease): boolean {
  if (release.runtime.type !== 'web' || release.runtime.integrity !== 'sha256-' + '0'.repeat(64)) {
    return false
  }
  const url = new URL(release.runtime.entryUrl)
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}
