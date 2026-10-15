import type { AppRelease } from '@t-box/app-contracts'
import { timeManifest } from '@t-box/time-contracts'

export const timeRelease: AppRelease = {
  appId: 'time',
  releaseId: `time-${timeManifest.version}-web`,
  manifest: timeManifest,
  protocol: 1,
  kind: 'system',
  platforms: ['web', 'android', 'ios'],
  runtime: { type: 'web', entryUrl: 'http://localhost:5179/', integrity: 'sha256-' + '0'.repeat(64) },
  backend: { type: 'none', binding: '' },
  permissions: ['api.request', 'storage', 'device.reminders'],
  clientTools: ['time_reminders_sync'],
  defaultInstalled: true,
}
