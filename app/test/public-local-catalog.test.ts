import type { AppRelease } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePublicLocalCatalog } from '../src/core/app-runtime/publicLocalCatalog'

const digest = 'a'.repeat(64)
const release: AppRelease = {
  appId: 'math',
  releaseId: 'math-1',
  protocol: 1,
  kind: 'system',
  defaultInstalled: true,
  guestAccess: 'local',
  platforms: ['web'],
  manifest: { id: 'math', name: '数学', description: '', icon: 'apps', color: 'blue', version: '1.0.0', skillIds: ['math'] },
  backend: { type: 'local', binding: 'private-binding' },
  permissions: ['storage', 'math.write'],
  clientTools: ['math.create'],
  runtime: { type: 'web', entryUrl: `https://assets.test/math/${digest}/`, integrity: `sha256-${digest}` },
}
const allowed = new Set(['math'])
const parse = (entries: AppRelease[]) => parsePublicLocalCatalog({ protocol: 1, applications: entries }, allowed, 'https://host.test')
test('a public or cached guest catalog carries static metadata and local storage, never cloud capabilities', () => {
  const [parsed] = parse([release])
  assert.deepEqual(parsed?.permissions, ['storage'])
  assert.deepEqual(parsed?.backend, { type: 'none', binding: '' })
  assert.deepEqual(parsed?.clientTools, release.clientTools)
  assert.deepEqual(parsed?.manifest.skillIds, [])
  assert.deepEqual(parse(JSON.parse(JSON.stringify([parsed]))), [parsed])
})
test('untrusted app IDs, account apps, same-origin code, invalid content paths and unsigned native URLs cannot opt into web guest access', () => {
  for (const entry of [
    { ...release, guestAccess: undefined },
    { ...release, kind: 'user' as const },
    { ...release, appId: 'other', manifest: { ...release.manifest, id: 'other' } },
    ...['https://host.test', 'https://bundled.tbox.invalid'].map((origin) => ({ ...release, runtime: { type: 'web' as const, entryUrl: `${origin}/math/${digest}/`, integrity: `sha256-${digest}` } })),
    { ...release, runtime: { type: 'web' as const, entryUrl: 'https://assets.test/latest/', integrity: `sha256-${digest}` } },
  ]) {
    assert.throws(() => parse([entry]))
  }
  assert.throws(() => parse([release, release]))
  assert.deepEqual(parse([]), [])
})
