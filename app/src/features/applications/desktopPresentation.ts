import type { MarketEntry } from '@t-box/app-contracts'
import type { DesktopApplication } from '@t-box/shared'

/** Presentation follows the installed immutable release, never a draft or an uninstalled update. */
export function refreshDesktopManifests(apps: readonly DesktopApplication[], entries: readonly MarketEntry[]): DesktopApplication[] {
  return apps.map((app) => {
    const entry = entries.find((row) => row.release.appId === app.manifest.id)
    const installed = entry?.installation?.status === 'active' ? entry.installedRelease : undefined
    return installed ? { ...app, manifest: installed.manifest } : app
  })
}
