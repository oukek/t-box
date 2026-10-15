import type { AppRelease } from '@t-box/app-contracts'
import { calculatorRelease } from '@t-box/calculator-server'
import { ledgerRelease } from '@t-box/ledger-server'
import { systemApplicationManifests } from '@t-box/shared'
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
  ledger: 'user',
  calculator: 'system',
  calendar: 'system',
  time: 'system',
  profile: 'system',
  market: 'system',
}
/** Build-time composition of trusted deployments. Legacy apps remain shell modules until migrated. */
export const deployedApplications: readonly AppRelease[] =
  systemApplicationManifests.map((manifest) =>
    manifest.id === 'calculator' || manifest.id === 'ledger'
      ? webRelease(manifest.id === 'calculator' ? calculatorRelease : ledgerRelease)
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
