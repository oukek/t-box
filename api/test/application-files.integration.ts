import type { AppRelease } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from '../src/app.js'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const users: string[] = []
const ids = [0, 1].map(() => `files-${randomUUID().slice(0, 8)}`)
const releases: AppRelease[] = ids.map((id) => ({
  appId: id,
  releaseId: `${id}-1`,
  manifest: { id, name: '文件测试', description: 'fixture', version: '1.0.0', icon: 'apps', color: 'blue', skillIds: [] },
  protocol: 1,
  kind: 'user',
  platforms: ['web', 'android', 'ios'],
  runtime: { type: 'web', entryUrl: 'https://files.example.test/', integrity: 'sha256-' + 'a'.repeat(64) },
  backend: { type: 'none', binding: '' },
  permissions: ['files'],
  clientTools: [],
  defaultInstalled: false,
}))
const catalog = new ApplicationPlatform(source, releases)
Object.assign(platform, { applications: catalog })
const app = createApp({ platform, bills: {} as any, health: async () => ({ mysql: 'up', redis: 'disabled' }) })
try {
  const sessions = []
  for (let i = 0; i < 2; i++) {
    const session = await platform.identity.register({ username: `files_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '文件测试' }, 'application-files-fixture')
    sessions.push(session)
    users.push(session.user.id)
  }
  await catalog.initialize()
  const [a, b] = sessions
  assert.ok(a && b)
  const [release] = releases
  const bytes = Buffer.from([0, 1, 2, 253, 254, 255])
  const path = `/api/v1/applications/${release!.appId}/files`
  const upload = (token = '') => app.inject({ method: 'POST', url: path, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('测试.bin') }, payload: bytes })
  assert.equal((await upload()).statusCode, 401)
  assert.equal((await upload(a.token)).statusCode, 403)
  for (const owner of sessions) {
    for (const item of releases) {
      await catalog.change(owner.user.id, item.appId, 'install', item.releaseId, randomUUID(), ['files'])
    }
  }
  const uploaded = await upload(a.token)
  assert.equal(uploaded.statusCode, 201, uploaded.body)
  const file = uploaded.json().data
  assert.equal(file.name, '测试.bin')
  assert.equal(file.mimeType, 'application/octet-stream')
  async function read(appId: string, token: string, id = file.id) {
    return app.inject({ method: 'GET', url: `/api/v1/applications/${appId}/files/${id}`, headers: { authorization: `Bearer ${token}` } })
  }
  const allowed = await read(release!.appId, a.token)
  assert.equal(allowed.statusCode, 200, allowed.body)
  assert.deepEqual(Buffer.from(allowed.json().data.base64, 'base64'), bytes)
  assert.equal(allowed.headers['cache-control'], 'private, no-store')
  assert.equal(allowed.body.includes(a.token), false)
  assert.equal((await read(ids[1]!, a.token)).statusCode, 404, 'Another app cannot read the account file by guessing its ID')
  assert.equal((await read(ids[0]!, b.token)).statusCode, 404, 'Another account cannot reuse file grants')
  const actor = await platform.identity.authenticate(a.token)
  const unshared = await platform.resources.create(actor, 'host-only.txt', Buffer.from('private host fixture'))
  assert.equal((await read(ids[0]!, a.token, unshared.id)).statusCode, 404, 'Host uploads do not implicitly authorize apps')
  const before = (await catalog.assertActive(a.user.id, release!.appId)).installation.generation
  await catalog.change(a.user.id, release!.appId, 'uninstall', release!.releaseId, randomUUID(), [])
  assert.equal((await read(ids[0]!, a.token)).statusCode, 403)
  await catalog.change(a.user.id, release!.appId, 'install', release!.releaseId, randomUUID(), ['files'])
  assert.ok((await catalog.assertActive(a.user.id, release!.appId)).installation.generation > before)
  assert.equal((await read(ids[0]!, a.token)).statusCode, 404, 'Reinstallation requires a fresh file grant')
  const ctx = await catalog.context(a.user.id, release!.appId, 'ios')
  assert.ok(ctx.capabilities.includes('files.pick'))
  assert.ok(ctx.capabilities.includes('files.read'))
  console.log('Application files integration passed: explicit installation grants, arbitrary file types, account/app isolation, private content and reinstall revocation')
} finally {
  await app.close()
  await cleanupUsers(source, users)
  for (const id of ids) {
    await source.query('DELETE FROM application_releases WHERE app_id=?', [id])
    await source.query('DELETE FROM application_registry WHERE app_id=?', [id])
  }
  await source.destroy()
}
