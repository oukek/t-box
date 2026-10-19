import type { AppRelease } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import { DataSource } from 'typeorm'
import { publicLocalReleases } from '../src/application-platform/public-local.js'
import { registerApplicationPlatform } from '../src/application-platform/routes.js'
import { ApplicationPlatform } from '../src/application-platform/service.js'

const digest = 'b'.repeat(64)
const release: AppRelease = {
  appId: 'math',
  releaseId: 'math-1',
  protocol: 1,
  kind: 'system',
  guestAccess: 'local',
  defaultInstalled: true,
  platforms: ['web'],
  manifest: { id: 'math', name: '数学', description: '', icon: 'apps', color: 'blue', version: '1.0.0', skillIds: ['math'] },
  backend: { type: 'local', binding: 'math' },
  permissions: ['storage', 'math.write'],
  clientTools: ['math.create'],
  runtime: { type: 'web', entryUrl: `https://assets.test/math/${digest}/`, integrity: `sha256-${digest}` },
}
test('public local releases require a trusted app declaration and a published immutable deployment', () => {
  const [entry] = publicLocalReleases([release], new Set(['math']))
  assert.equal(entry?.guestAccess, 'local')
  assert.deepEqual(entry?.permissions, ['storage'])
  assert.deepEqual(entry?.backend, { type: 'none', binding: '' })
  assert.deepEqual(entry?.clientTools, release.clientTools)
  assert.deepEqual(entry?.manifest.skillIds, [])
  assert.deepEqual(publicLocalReleases([release], new Set()), [])
  assert.deepEqual(publicLocalReleases([{ ...release, guestAccess: undefined }], new Set(['math'])), [], 'older server-dependent versions cannot inherit guest access')
  assert.deepEqual(publicLocalReleases([{ ...release, kind: 'user' }], new Set(['math'])), [])
  const dev = { ...release, runtime: { type: 'web' as const, entryUrl: 'http://localhost:5180/', integrity: 'sha256-' + '0'.repeat(64) } }
  assert.deepEqual(publicLocalReleases([dev], new Set(['math'])), [])
  assert.equal(publicLocalReleases([dev], new Set(['math']), true).length, 1)
})
test('the guest metadata endpoint requires no identity and exposes no installation or grant', async () => {
  class PublicPlatform extends ApplicationPlatform {
    override async publicLocalCatalog() {
      return publicLocalReleases([release], new Set(['math']))
    }
  }
  const service = new PublicPlatform(new DataSource({ type: 'mysql' }), [])
  const app = Fastify()
  registerApplicationPlatform(app, service, async () => {
    assert.fail('Public catalog must not authenticate')
  })
  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1/app-market/local' })
    assert.equal(response.statusCode, 200)
    const body = response.json<{ protocol: number, applications: AppRelease[] }>()
    assert.equal(body.protocol, 1)
    assert.equal(body.applications[0]?.appId, 'math')
    for (const field of ['userId', 'installation', 'subject', 'grants', 'token']) {
      assert.equal(JSON.stringify(body).includes(`"${field}"`), false)
    }
  } finally {
    await app.close()
  }
})
