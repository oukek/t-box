import type { AppRelease, MarketEntry } from '@t-box/app-contracts'
import type { DesktopApplication } from '@t-box/shared'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { systemApplicationManifests } from '@t-box/shared'
import { refreshDesktopManifests } from '../src/features/applications/desktopPresentation'

const babyDiaryRelease: AppRelease = {
  appId: 'baby-diary',
  releaseId: 'baby-1',
  manifest: systemApplicationManifests.find((app) => app.id === 'baby-diary')!,
  protocol: 1,
  kind: 'user',
  platforms: ['web'],
  runtime: { type: 'shell' },
  backend: { type: 'none', binding: '' },
  permissions: [],
  clientTools: [],
  defaultInstalled: false,
}

test('an installed release updates desktop artwork without changing layout or adopting an available update', () => {
  const initial: DesktopApplication = { manifest: babyDiaryRelease.manifest, installation: { kind: 'user', uninstallable: true, status: 'active', error: null }, aiAvailable: true }
  const installed = { ...babyDiaryRelease, releaseId: 'baby-installed-2', manifest: { ...babyDiaryRelease.manifest, version: '2.0.0', iconAsset: 'data:image/png;base64,new-installed-icon' } }
  const latest = { ...installed, releaseId: 'baby-available-3', manifest: { ...installed.manifest, version: '3.0.0', iconAsset: 'data:image/png;base64,uninstalled-icon' } }
  const entry: MarketEntry = { release: latest, installedRelease: installed, installation: { appId: 'baby-diary', releaseId: installed.releaseId, generation: 1, status: 'active', targetReleaseId: null, operationId: null, grants: [] } }
  const [updated] = refreshDesktopManifests([initial], [entry])
  assert.equal(updated!.manifest.iconAsset, installed.manifest.iconAsset)
  assert.equal(updated!.manifest.version, '2.0.0')
  assert.equal(updated!.installation, initial.installation)
  assert.equal(initial.manifest.version, babyDiaryRelease.manifest.version)
  assert.equal(refreshDesktopManifests([initial], [])[0], initial, 'offline catalog absence preserves installed presentation')
})
