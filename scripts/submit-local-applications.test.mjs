import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { discoverApplications } from './application-builds.mjs'
import { submitLocalApplications } from './submit-local-applications.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
for (const selection of ['baby-diary', 'all']) {
  test(`local application submission selects ${selection} without publishing`, async () => {
    const built = []
    const calls = []
    const environment = { NODE_ENV: 'development' }
    const pack = async (_root, appId) => {
      built.push(appId)
      return { version: '1.2.0', file: 'fixture.json' }
    }
    await submitLocalApplications(root, selection, environment, (_command, args, options) => {
      calls.push(args)
      assert.equal(options.env, environment)
      assert.ok(args.includes('src/application-platform/submit-local-cli.ts'))
      assert.ok(!args.includes('publish'))
      return { status: 0 }
    }, pack)
    assert.deepEqual(built, selection === 'all' ? (await discoverApplications(root)).map((app) => app.appId) : [selection])
    assert.equal(calls.length, built.length)
  })
}
test('local submission stops on failure and rejects production/unknown selections', async () => {
  const built = []
  const pack = async (_root, appId) => {
    built.push(appId)
    return { version: '1.0.0', file: 'fixture.json' }
  }
  await assert.rejects(submitLocalApplications(root, 'baby-diary', { NODE_ENV: 'production' }, undefined, pack), /unavailable in production/)
  await assert.rejects(submitLocalApplications(root, '../unknown', {}, undefined, pack), /not independently buildable/)
  assert.equal(built.length, 0)
  await assert.rejects(submitLocalApplications(root, 'all', {}, () => ({ status: 1 }), pack), /Earlier successful submissions remain unpublished/)
  assert.equal(built.length, 1)
})
