import type { DesktopAppearanceSnapshot, DesktopWallpapers } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { defaultDesktopWallpapers } from '@t-box/app-contracts'
import { createApp } from '../src/app.js'
import { createDataSource } from '../src/db/data-source.js'
import { DesktopAppearanceService } from '../src/desktop/appearance.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const app = createApp({ platform, bills: {} as any, corsOrigins: ['http://localhost:5173'], health: async () => ({ mysql: 'up', redis: 'disabled' }) })
const users: string[] = []
async function call(method: any, url: string, token = '', payload?: unknown, expected = 200) {
  const reply = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload === undefined ? {} : { payload: payload as any }) })
  assert.equal(reply.statusCode, expected, `${method} ${url}: ${reply.body}`)
  return expected === 204 ? undefined : reply.json().data
}
try {
  const sessions = []
  for (let index = 0; index < 2; index++) {
    const session = await call('POST', '/api/v1/auth/register', '', { username: `test_wallpaper_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '壁纸测试' }, 201)
    users.push(session.user.id)
    sessions.push(session)
  }
  const [a, b] = sessions
  const endpoint = '/api/v1/desktop/appearance'
  await call('GET', endpoint, '', undefined, 401)
  await call('PUT', endpoint, '', { revision: 0, wallpapers: defaultDesktopWallpapers() }, 401)
  const initial: DesktopAppearanceSnapshot = await call('GET', endpoint, a.token)
  assert.deepEqual(initial, { revision: 0, wallpapers: defaultDesktopWallpapers() })
  for (const malformed of [
    { revision: -1, wallpapers: initial.wallpapers },
    { revision: 0, wallpapers: { ...initial.wallpapers, common: null } },
    { revision: 0, wallpapers: { ...initial.wallpapers, pc: { kind: 'builtin', id: 'unknown' } } },
    { revision: 0, wallpapers: { ...initial.wallpapers, mobile: { kind: 'url', url: 'http://127.0.0.1/private' } } },
    { revision: 0, wallpapers: initial.wallpapers, userId: b.user.id },
    { revision: 0, wallpapers: { ...initial.wallpapers, phone: null } },
  ]) {
    await call('PUT', endpoint, a.token, malformed, 400)
  }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF7sAAAAASUVORK5CYII=', 'base64')
  async function upload(name: string, bytes: Buffer) {
    const reply = await app.inject({ method: 'POST', url: '/api/v1/resources', headers: { 'authorization': `Bearer ${a.token}`, 'content-type': 'application/octet-stream', 'x-file-name': name }, payload: bytes })
    assert.equal(reply.statusCode, 201, reply.body)
    return reply.json().data
  }
  const image = await upload('wallpaper.png', png)
  const text = await upload('not-a-wallpaper.txt', Buffer.from('not an image'))
  const custom: DesktopWallpapers = { common: { kind: 'resource', resourceId: image.id }, mobile: { kind: 'builtin', id: 'coast-dusk' }, tablet: { kind: 'resource', resourceId: image.id }, pc: null }
  await call('PUT', endpoint, b.token, { revision: 0, wallpapers: custom }, 400)
  await call('PUT', endpoint, a.token, { revision: 0, wallpapers: { ...initial.wallpapers, pc: { kind: 'resource', resourceId: text.id } } }, 400)
  await call('PUT', endpoint, a.token, { revision: 0, wallpapers: { ...initial.wallpapers, pc: { kind: 'resource', resourceId: randomUUID() } } }, 400)
  const saved = await call('PUT', endpoint, a.token, { revision: 0, wallpapers: custom })
  assert.equal(saved.revision, 1)
  assert.deepEqual(saved.wallpapers, custom)
  assert.deepEqual(await new DesktopAppearanceService(source).get(a.user.id), saved)
  assert.deepEqual(await call('GET', endpoint, b.token), initial)
  assert.equal((await call('PUT', endpoint, a.token, { revision: 0, wallpapers: custom })).revision, 1)
  const privateRead = await app.inject({ method: 'GET', url: `/api/v1/resources/${image.id}/content`, headers: { authorization: `Bearer ${b.token}` } })
  assert.equal(privateRead.statusCode, 404)

  const race = await Promise.all(['coast-dusk', 'dunes-dusk'].map((id) => app.inject({ method: 'PUT', url: endpoint, headers: { authorization: `Bearer ${a.token}` }, payload: { revision: saved.revision, wallpapers: { ...defaultDesktopWallpapers(), common: { kind: 'builtin', id } } } })))
  assert.deepEqual(race.map((reply) => reply.statusCode).sort(), [200, 409])
  const latest = await call('GET', endpoint, a.token)
  await call('PUT', endpoint, a.token, { revision: latest.revision, wallpapers: custom })
  await call('DELETE', `/api/v1/resources/${image.id}`, a.token, undefined, 204)
  const fallback = await call('GET', endpoint, a.token)
  assert.deepEqual(fallback.wallpapers, { ...defaultDesktopWallpapers(), mobile: custom.mobile })
  await call('PUT', endpoint, a.token, { revision: fallback.revision, wallpapers: custom }, 400)
  const preflight = await app.inject({ method: 'OPTIONS', url: endpoint, headers: { 'origin': 'http://localhost:5173', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' } })
  assert.equal(preflight.statusCode, 204)
  console.log('Desktop appearance integration passed: private uploads, account persistence, device overrides, deletion fallback, concurrent versioning and CORS')
} finally {
  await app.close()
  await cleanupUsers(source, users)
  await source.destroy()
}
