import type { ApplicationManifest } from '@t-box/app-contracts'
import { babyDiaryManifest } from '@t-box/baby-diary-contracts'
import { legacyApplicationIcon as calculatorLegacyIcon } from '@t-box/calculator-contracts'
import { calendarManifest } from '@t-box/calendar-contracts/index'
import { legacyApplicationIcon as calendarLegacyIcon } from '@t-box/calendar-contracts/legacy-icon'
import { converterManifest } from '@t-box/converter-contracts'
import { legacyApplicationIcon as ledgerLegacyIcon } from '@t-box/ledger-contracts/legacy-icon'
import { ledgerManifest } from '@t-box/ledger-contracts/manifest'
import { marketManifest } from '@t-box/market-contracts'
import { legacyApplicationIcon as marketLegacyIcon } from '@t-box/market-contracts/legacy-icon'
import { profileManifest } from '@t-box/settings-contracts'
import { legacyApplicationIcon as settingsLegacyIcon } from '@t-box/settings-contracts/legacy-icon'
import { timeManifest } from '@t-box/time-contracts/index'
import { legacyApplicationIcon as timeLegacyIcon } from '@t-box/time-contracts/legacy-icon'
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
  babyDiaryManifest,
  calculatorManifest,
  converterManifest,
  calendarManifest,
  timeManifest,
  profileManifest,
  marketManifest,
]
/** Only known retired default images receive the restored presentation. Custom uploads stay intact. */
const legacyIcons: Readonly<Record<string, string>> = { ledger: ledgerLegacyIcon, calculator: calculatorLegacyIcon, calendar: calendarLegacyIcon, time: timeLegacyIcon, profile: settingsLegacyIcon, market: marketLegacyIcon }
export function presentApplicationIcon<T extends Pick<ApplicationManifest, 'id' | 'icon' | 'iconAsset' | 'iconVariant'>>(manifest: T): T {
  const source = systemApplicationManifests.find((app) => app.id === manifest.id)
  if (source && !manifest.iconVariant && (!manifest.iconAsset || manifest.iconAsset === legacyIcons[manifest.id])) {
    return { ...manifest, iconAsset: source.iconAsset, iconVariant: source.iconVariant }
  }
  return manifest
}
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
