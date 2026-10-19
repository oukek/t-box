import type { AppRelease } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { checkDevelopmentEntry } from '../src/core/app-runtime/developmentEntry'
import { localApplications, localBaselineLaunch, localEntries, mergeLocalEntries, parseBundledApplications } from '../src/core/app-runtime/localApplications'

const release: AppRelease = {
  appId: 'offline_math',
  releaseId: 'offline_math-bundled-1',
  protocol: 1,
  kind: 'system',
  platforms: ['web', 'android', 'ios'],
  defaultInstalled: true,
  manifest: { id: 'offline_math', name: '数学', version: '1.0.0', icon: 'apps', color: 'blue', description: '', skillIds: [] },
  backend: { type: 'local', binding: 'math' },
  permissions: ['storage'],
  clientTools: [],
  runtime: { type: 'web', entryUrl: `https://bundled.tbox.invalid/offline_math/${'a'.repeat(64)}/`, integrity: 'sha256-' + 'a'.repeat(64) },
}
test('native signed baselines open for guests without installing an account or granting backend permissions', () => {
  localApplications.releases = parseBundledApplications({ protocol: 1, applications: [release] })
  try {
    const guest = localBaselineLaunch(release.appId, 'ios')!
    assert.equal(guest.descriptor?.localOnly, true)
    assert.deepEqual(guest.context.permissions, [])
    assert.ok(guest.context.capabilities.includes('storage.get'))
    assert.ok(!guest.context.capabilities.includes('api.invoke'))
    assert.notEqual(localBaselineLaunch(release.appId, 'ios', 'another-account')?.context.subject, guest.context.subject)
    assert.equal(localBaselineLaunch(release.appId, 'ios')?.context.subject, guest.context.subject)
    const installed = { ...localEntries()[0]!, localOnly: undefined }
    assert.equal(mergeLocalEntries([installed])[0], installed, 'a real installation stays authoritative; shipping must not activate a server version')
  } finally {
    localApplications.releases = []
  }
})
test('user applications, foreign origins, duplicate IDs and non-native packages cannot become shipped guest tools', () => {
  for (const value of [
    { ...release, kind: 'user' },
    { ...release, defaultInstalled: false },
    { ...release, platforms: ['web'] },
    { ...release, runtime: { type: 'web', entryUrl: 'https://untrusted.test/', integrity: 'sha256-' + 'a'.repeat(64) } },
  ]) {
    assert.throws(() => parseBundledApplications({ protocol: 1, applications: [value] }))
  }
  assert.throws(() => parseBundledApplications({ protocol: 1, applications: [release, release] }))
})
test('a missing Vite service produces an actionable error before waiting for a nonexistent SDK handshake', async () => {
  await assert.rejects(checkDevelopmentEntry('converter', 'http://localhost:5180/', async (_url, options) => {
    assert.equal(options?.credentials, 'omit')
    assert.equal(options?.headers, undefined)
    return new Response(JSON.stringify({ ready: false }))
  }), /5180.*pnpm dev/)
})
