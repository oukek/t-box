/** Only synthetic users/releases in a disposable database; no app publishing or installations on developer accounts. */
import type { AppRelease } from '@t-box/app-contracts'
import type { Actor } from '@t-box/app-server-sdk'
import type { PlatformService } from '../src/platform/service.js'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { ApplicationCatalogMonitor } from '../src/application-platform/catalog-monitor.js'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { registerApplicationCatalogSocket } from '../src/application-platform/socket.js'
import { createDataSource } from '../src/db/data-source.js'
import { IdentityService } from '../src/identity/service.js'
import { cleanupUsers } from './fixtures.js'

if (!/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('Use a disposable test database')
}
const source = await createDataSource().initialize()
const other = await createDataSource().initialize()
const identity = new IdentityService(source)
const applications = new ApplicationPlatform(source, [])
const monitor = new ApplicationCatalogMonitor(source)
const server = Fastify()
await server.register(websocket)
registerApplicationCatalogSocket(server, { identity, applicationCatalogUpdates: monitor } as PlatformService, new Set(['http://localhost:5173']))
await server.ready()
const marker = randomUUID().slice(0, 8)
const appId = `update_${marker}`
const userIds: string[] = []
const stops: (() => void)[] = []
const sockets: { terminate(): void }[] = []
try {
  const accounts = await Promise.all([1, 2].map((index) => identity.register({ username: `update_${marker}_${index}`, password: 'test123' }, `update_${marker}_${index}`)))
  userIds.push(...accounts.map((account) => account.user.id))
  const actors = await Promise.all(accounts.map((account) => identity.authenticate(account.token)))
  const release = (version: string, mode: 'default' | 'custom'): AppRelease => ({ appId, releaseId: `${appId}_${version}`, protocol: 1, kind: 'user', manifest: { id: appId, name: '测试更新', description: '测试', version, icon: 'apps', color: 'blue', skillIds: [] }, platforms: ['web'], runtime: { type: 'shell' }, backend: { type: 'none', binding: '' }, permissions: [], clientTools: [], defaultInstalled: false, updatePrompt: { mode } })
  const first = release('1.0.0', 'custom')
  const next = release('1.1.0', 'default')
  await source.query('INSERT INTO application_registry(app_id,kind) VALUES(?,?)', [appId, 'user'])
  const save = async (value: AppRelease, published: number) => source.query('INSERT INTO application_releases(release_id,app_id,definition,definition_hash,published,status,release_notes) VALUES(?,?,?,?,?,?,?)', [value.releaseId, appId, JSON.stringify(value), createHash('sha256').update(JSON.stringify(value)).digest('hex'), published, published ? 'published' : 'draft', '新版说明'])
  await save(first, 1)
  for (const actor of actors) {
    await source.query('INSERT INTO application_installations(user_id,app_id,release_id,status,grants) VALUES(?,?,?,?,?)', [actor.user.id, appId, first.releaseId, 'active', '[]'])
  }
  const hints: string[][] = [[], []]
  let revoked = false
  actors.forEach((actor, index) => stops.push(monitor.subscribe(actor as Actor, (revision) => hints[index]!.push(revision), () => {
    revoked = true
  })))
  await Promise.all([monitor.tick(), monitor.tick()])
  assert.deepEqual(hints.map((hint) => hint.length), [1, 1])
  await monitor.tick()
  assert.deepEqual(hints.map((hint) => hint.length), [1, 1])
  await save(next, 0)
  await monitor.tick()
  assert.deepEqual(hints.map((hint) => hint.length), [1, 1], 'drafts are not updates')
  // Independent DataSource represents another API worker publishing atomically.
  await other.transaction(async (db) => {
    await db.query('UPDATE application_releases SET published=0,status=? WHERE release_id=?', ['retired', first.releaseId])
    await db.query('UPDATE application_releases SET published=1,status=? WHERE release_id=?', ['published', next.releaseId])
  })
  await monitor.tick()
  assert.deepEqual(hints.map((hint) => hint.length), [2, 2])
  const entry = (await applications.catalog(userIds[0]!)).find((entry) => entry.release.appId === appId)!
  assert.equal(entry.release.releaseId, next.releaseId)
  assert.equal(entry.installation!.releaseId, first.releaseId, 'publication must not install automatically')
  assert.equal(entry.installedUpdatePrompt!.mode, 'custom', 'running release owns custom UI')
  assert.equal(entry.releaseNotes, '新版说明')
  assert.equal((await applications.context(userIds[0]!, appId, 'web')).updatePrompt!.mode, 'custom')
  await monitor.tick() // bootstrap may initialize other defaults in this disposable database
  const baseline = hints.map((hint) => hint.length)
  await other.query('UPDATE application_installations SET generation=generation+1 WHERE user_id=? AND app_id=?', [userIds[0], appId])
  await monitor.tick()
  assert.deepEqual(hints.map((hint) => hint.length), [baseline[0]! + 1, baseline[1]], 'other users do not receive private installation changes')
  await assert.rejects(server.injectWS('/api/v1/app-market/ws', { headers: { origin: 'https://evil.invalid' } }))
  const socket = await server.injectWS('/api/v1/app-market/ws', { headers: { origin: 'http://localhost:5173' } })
  sockets.push(socket)
  const received: { type: string, revision?: string }[] = []
  socket.on('message', (data) => received.push(JSON.parse(data.toString())))
  socket.send(JSON.stringify({ type: 'authenticate', token: accounts[0]!.token }))
  for (let count = 0; count < 100 && !received.some((event) => event.type === 'catalog.changed'); count++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.deepEqual(received.slice(0, 2).map((event) => event.type), ['ready', 'catalog.changed'])
  assert.match(received[1]!.revision!, /^[a-f0-9]{64}$/)
  const closed = new Promise<number>((resolve) => socket.once('close', resolve))
  await other.query('DELETE FROM user_sessions WHERE token_hash=?', [actors[0]!.sessionHash])
  await monitor.tick()
  assert.equal(revoked, true)
  assert.equal(await closed, 1008)
  const rejected = await server.injectWS('/api/v1/app-market/ws', { headers: { origin: 'http://localhost:5173' } })
  sockets.push(rejected)
  const denied = new Promise<number>((resolve) => rejected.once('close', resolve))
  rejected.send(JSON.stringify({ type: 'authenticate', token: 'invalid' }))
  assert.equal(await denied, 1008)
  process.stdout.write('Catalog updates: cross-process publication, private installation changes, installed UI policy, authenticated socket and revocation passed.\n')
} finally {
  for (const stop of stops) {
    stop()
  }
  for (const socket of sockets) {
    socket.terminate()
  }
  await server.close()
  await source.query('DELETE FROM application_installations WHERE app_id=?', [appId])
  await source.query('DELETE FROM application_releases WHERE app_id=?', [appId])
  await source.query('DELETE FROM application_registry WHERE app_id=?', [appId])
  await cleanupUsers(source, userIds)
  await other.destroy()
  await source.destroy()
}
