import type { AppRelease } from '@t-box/app-contracts'
import { ledgerManifest } from '@t-box/ledger-contracts'

/** REST remains in the ledger domain; the host mediates only its declared interface scope. */
export const ledgerRelease: AppRelease = {
  appId: 'ledger',
  releaseId: 'ledger-1.1.0-web',
  manifest: ledgerManifest,
  protocol: 1,
  kind: 'user',
  platforms: ['web', 'android', 'ios'],
  runtime: { type: 'web', entryUrl: 'http://localhost:5177/', integrity: 'sha256-' + '0'.repeat(64) },
  backend: { type: 'none', binding: '' },
  permissions: ['api.request', 'storage', 'events.books', 'resources.bindings'],
  clientTools: ['application_authorize', 'finance_confirm'],
  defaultInstalled: true,
}
