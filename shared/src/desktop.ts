import type { ApplicationManifest } from '@t-box/app-contracts'
import { calendarManifest } from '@t-box/calendar-contracts/index'
import { ledgerManifest } from '@t-box/ledger-contracts/manifest'
import { marketManifest } from '@t-box/market-contracts'
import { profileManifest } from '@t-box/settings-contracts'
import { timeManifest } from '@t-box/time-contracts/index'
import { calculatorManifest } from './applications/calculator/index.js'

export type DesktopDevice = 'mobile' | 'pc'
export type ApplicationKind = 'system' | 'user'
/** Installation identity is independent of AI capabilities. Future user apps need trusted installation records. */
export interface ApplicationInstallation {
  kind: ApplicationKind
  uninstallable: boolean
  installationId?: string
  status?: import('@t-box/app-contracts').InstallationStatus
  error?: string | null
}
export interface DesktopApplication {
  manifest: ApplicationManifest
  installation: ApplicationInstallation
  aiAvailable: boolean
}
export interface DesktopLayout {
  device: DesktopDevice
  revision: number
  catalogRevision: string
  appIds: string[]
}
export interface DesktopSnapshot extends DesktopLayout {
  applications: DesktopApplication[]
}
export { marketManifest } from '@t-box/market-contracts'
export { profileManifest } from '@t-box/settings-contracts'
/** Trusted first-party desktop catalog; registering an AI module is optional. */
export const systemApplicationManifests: readonly ApplicationManifest[] = [
  ledgerManifest,
  calculatorManifest,
  calendarManifest,
  timeManifest,
  profileManifest,
  marketManifest,
]
export function reconcileDesktopOrder(
  saved: readonly string[],
  available: readonly string[],
): string[] {
  const allowed = new Set(available)
  return [...new Set([...saved.filter((id) => allowed.has(id)), ...available])]
}
export function moveDesktopApp(
  order: readonly string[],
  appId: string,
  targetId: string,
): string[] {
  const result = [...order]
  const from = result.indexOf(appId)
  const to = result.indexOf(targetId)
  if (from < 0 || to < 0 || from === to) {
    return result
  }
  result.splice(from, 1)
  result.splice(to, 0, appId)
  return result
}
