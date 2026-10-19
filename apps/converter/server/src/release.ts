import type { AppRelease } from '@t-box/app-contracts'
import { converterManifest } from '@t-box/converter-contracts'

export const converterRelease: AppRelease = {
  appId: 'converter',
  releaseId: `converter-${converterManifest.version}`,
  manifest: converterManifest,
  protocol: 1,
  kind: 'system',
  platforms: ['web', 'android', 'ios'],
  runtime: { type: 'web', entryUrl: 'http://localhost:5180/', integrity: 'sha256-' + '0'.repeat(64) },
  backend: { type: 'local', binding: 'converter' },
  permissions: ['converter.catalog', 'converter.convert', 'converter.batch', 'storage'],
  clientTools: [],
  defaultInstalled: true,
  guestAccess: 'local',
}
