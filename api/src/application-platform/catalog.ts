import type { AppRelease } from '@t-box/app-contracts'
import { calculatorRelease } from '@t-box/calculator-server'
import { systemApplicationManifests } from '@t-box/shared'
import { resolveWebDeployment } from './deployment.js'
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
    manifest.id === 'calculator'
      ? resolveWebDeployment(calculatorRelease)
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
