import type { AppRelease } from '@t-box/app-contracts'
import { calendarManifest } from '@t-box/calendar-contracts'

export const calendarRelease: AppRelease = {
  appId: 'calendar',
  releaseId: `calendar-${calendarManifest.version}-web`,
  manifest: calendarManifest,
  protocol: 1,
  kind: 'system',
  platforms: ['web', 'android', 'ios'],
  runtime: { type: 'web', entryUrl: 'http://localhost:5178/', integrity: 'sha256-' + '0'.repeat(64) },
  backend: { type: 'none', binding: '' },
  permissions: ['api.request', 'storage', 'device.reminders'],
  clientTools: ['calendar_confirm', 'calendar_reminders_sync'],
  defaultInstalled: true,
  guestAccess: 'local',
}
