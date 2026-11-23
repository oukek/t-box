import type { AppRelease } from '@t-box/app-contracts'
import { manifest } from '@t-box/shop-tools-contracts'

export const applicationRelease: AppRelease = {
  appId: 'shop-tools',
  releaseId: `shop-tools-${manifest.version}`,
  manifest,
  protocol: 1,
  kind: 'user',
  platforms: ['web', 'ios', 'android'],
  runtime: {
    type: 'web',
    entryUrl: 'http://localhost:5182/',
    integrity: 'sha256-' + '0'.repeat(64),
  },
  backend: { type: 'local', binding: 'shop-tools' },
  permissions: [
    'shop-tools.workspace_get',
    'shop-tools.workspace_rows',
    'shop-tools.workspace_patch',
    'shop-tools.projects',
    'shop-tools.creative',
    'files',
    'shop-tools.rates',
    'shop-tools.sites',
    'shop-tools.changelog',
  ],
  clientTools: [],
  defaultInstalled: false,
}
