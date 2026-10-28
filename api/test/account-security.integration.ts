import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from '../src/app.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const app = createApp({ platform, bills: {} as any, health: async () => ({ mysql: 'up', redis: 'disabled' }) })
const users: string[] = []
async function call(method: any, path: string, token = '', payload?: unknown, status = 200) {
  const response = await app.inject({ method, url: '/api/v1/auth' + path, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/150.0' }, ...(payload === undefined ? {} : { payload: payload as any }) })
  assert.equal(response.statusCode, status, `${method} ${path}: ${response.body}`)
  return status === 204 ? undefined : response.json().data
}
try {
  const username = `account_${randomUUID().replaceAll('-', '')}`
  const first = await platform.identity.register({ username, password: 'test123' }, 'fixture', 'Mac · Chrome')
  users.push(first.user.id)
  assert.equal(first.user.nickname.length, 40, 'Long usernames cannot overflow default nickname storage')
  const second = await platform.identity.login({ username, password: 'test123' }, 'fixture', 'Mac · Chrome')
  const foreign = await platform.identity.register({ username: `other_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '另一账号' }, 'fixture')
  users.push(foreign.user.id)
  const sessions = await call('GET', '/sessions', first.token)
  assert.equal(sessions.length, 2)
  assert.equal(sessions.filter((session: any) => session.current).length, 1)
  assert.equal(sessions[0].device, 'Mac · Chrome')
  assert.equal(JSON.stringify(sessions).includes(first.token), false)
  assert.equal(JSON.stringify(sessions).includes('token_hash'), false)
  const other = sessions.find((session: any) => !session.current)
  await call('DELETE', `/sessions/${other.id}`, foreign.token, undefined, 404)
  await call('DELETE', `/sessions/${other.id}`, first.token)
  await call('GET', '/me', second.token, undefined, 401)
  const third = await platform.identity.login({ username, password: 'test123' }, 'fixture', 'Mac · Chrome')
  await call('DELETE', '/sessions', first.token, undefined, 204)
  await call('GET', '/me', third.token, undefined, 401)
  await call('GET', '/me', first.token)

  for (const [method, path] of [['POST', '/register'], ['POST', '/login'], ['PATCH', '/password'], ['GET', '/recovery-codes'], ['POST', '/recovery-codes'], ['POST', '/password-recovery']] as const) {
    await call(method, path, first.token, {}, 404)
  }
  console.log('Account security integration passed: opaque device sessions, ownership/revocation, and no public password or registration endpoints')
} finally {
  await app.close()
  await cleanupUsers(source, users)
  await source.destroy()
}
