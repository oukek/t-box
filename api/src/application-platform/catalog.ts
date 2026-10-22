import type { AppRelease } from '@t-box/app-contracts'
import { babyDiaryRelease } from '@t-box/baby-diary-server'
import { calculatorRelease } from '@t-box/calculator-server'
import { calendarRelease } from '@t-box/calendar-server'
import { converterRelease } from '@t-box/converter-server'
import { ledgerRelease } from '@t-box/ledger-server'
import { systemApplicationManifests } from '@t-box/shared'
import { timeRelease } from '@t-box/time-server'
import { resolveWebDeployment } from './deployment.js'

export const deploymentIssues: Record<string, string> = {}
const webRelease = (release: AppRelease) => {
  try {
    return resolveWebDeployment(release)
  } catch {
    deploymentIssues[release.appId] = '应用资源部署尚未就绪，请管理员检查应用产物配置'
    return release
  }
}
/** App-level policy is independent of immutable historical release definitions. */
export const builtinKinds: Readonly<Record<string, AppRelease['kind']>> = {
  'ledger': 'user',
  'baby-diary': 'user',
  'calculator': 'system',
  'converter': 'system',
  'calendar': 'system',
  'time': 'system',
  'profile': 'system',
  'market': 'system',
}
const webReleases: Record<string, AppRelease> = { 'baby-diary': babyDiaryRelease, 'converter': converterRelease, 'calculator': calculatorRelease, 'ledger': ledgerRelease, 'calendar': calendarRelease, 'time': timeRelease }
/** Build-time composition of trusted deployments. Legacy apps remain shell modules until migrated. */
export const deployedApplications: readonly AppRelease[] =
  systemApplicationManifests.map((manifest) =>
    webReleases[manifest.id]
      ? webRelease(webReleases[manifest.id]!)
      : {
          appId: manifest.id,
          releaseId: `${manifest.id}-${manifest.version}`,
          manifest,
          protocol: 1,
          kind: builtinKinds[manifest.id] || 'system',
          platforms: ['web', 'android', 'ios'],
          runtime: { type: 'shell' },
          backend: { type: 'none', binding: '' },
          permissions: [],
          clientTools: [],
          defaultInstalled: true,
        },
  )
