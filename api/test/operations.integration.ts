import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createVault, hashPassword } from '../src/admin/crypto.js'
import { ConfigurationService } from '../src/admin/service.js'
import { AdminStore } from '../src/admin/store.js'
import { createApp } from '../src/app.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const administration = new ConfigurationService(new AdminStore(source), createVault(randomBytes(32)))
const app = createApp({ platform, administration, bills: {} as any, health: async () => ({ mysql: 'up', redis: 'disabled' }) })
const users: string[] = []
const username = `ops-${randomUUID().slice(0, 8)}`
let adminId = ''
const taskId = randomUUID()
let requestId = ''
try {
  adminId = await administration.store.createUser(username, await hashPassword('test123'))
  const session = await platform.identity.register({ username: `ops_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '运维测试' }, 'ops-fixture')
  users.push(session.user.id)
  const actor = await platform.identity.authenticate(session.token)
  await platform.tasks.create(actor, taskId, randomUUID(), 'ops-request', { userSecret: 'must-never-expose-checkpoint' }, 'fixture')
  await platform.operations.record({ kind: 'task_error', code: 'PROVIDER_TEST_FAILURE', requestId: 'ops-request', taskId, stage: 'execution', providerRequestId: 'provider-fixture-42', httpStatus: 503 })
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/operations' })).statusCode, 401)
  const login = await app.inject({ method: 'POST', url: '/api/v1/admin/session', headers: { 'x-admin-request': '1' }, payload: { username, password: 'test123' } })
  assert.equal(login.statusCode, 200)
  const cookie = String(login.headers['set-cookie']).split(';')[0]!
  async function read(path: string) {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin' + path, headers: { cookie } })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.headers['cache-control'], 'no-store')
    assert.ok(response.headers['x-request-id'])
    assert.equal(response.body.includes('must-never-expose-checkpoint'), false)
    assert.equal(response.body.includes(actor.sessionHash), false)
    return response.json().data
  }
  const overview = await read('/operations')
  assert.equal(overview.windowHours, 24)
  assert.ok(overview.tasks.some((item: any) => item.status === 'queued' && item.count >= 1))
  const events = await read('/operations/events')
  assert.ok(events.some((event: any) => event.taskId === taskId && event.providerRequestId === 'provider-fixture-42'))
  const task = await read(`/operations/tasks/${taskId}`)
  assert.equal(task.requestId, 'ops-request')
  assert.deepEqual(task.tools, [])
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/admin/operations/tasks/${randomUUID()}`, headers: { cookie } })).statusCode, 404)
  const failure = await app.inject({ method: 'GET', url: `/api/v1/admin/models/not-an-id/test`, headers: { cookie } })
  requestId = String(failure.headers['x-request-id'])
  assert.match(requestId, /^[a-f0-9-]{36}$/)
  console.log('Operations integration passed: admin-only access, request correlation, cost/task summaries and metadata privacy')
} finally {
  await app.close()
  await source.query('DELETE FROM operations_events WHERE task_id=? OR request_id=?', [taskId, requestId])
  await cleanupUsers(source, users)
  if (adminId) {
    await source.query('DELETE FROM admin_users WHERE id=?', [adminId])
  }
  await source.destroy()
}
