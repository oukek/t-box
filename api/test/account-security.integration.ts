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
  const first = await call('POST', '/register', '', { username, password: 'test123' }, 201)
  users.push(first.user.id)
  assert.equal(first.user.nickname.length, 40, 'Long usernames cannot overflow default nickname storage')
  const second = await call('POST', '/login', '', { username, password: 'test123' })
  const foreign = await call('POST', '/register', '', { username: `other_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '另一账号' }, 201)
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
  const third = await call('POST', '/login', '', { username, password: 'test123' })
  await call('DELETE', '/sessions', first.token, undefined, 204)
  await call('GET', '/me', third.token, undefined, 401)
  await call('GET', '/me', first.token)

  await call('POST', '/recovery-codes', first.token, { currentPassword: 'wrong-password' }, 400)
  assert.equal((await call('GET', '/recovery-codes', first.token)).remaining, 0)
  const { codes } = await call('POST', '/recovery-codes', first.token, { currentPassword: 'test123' })
  assert.equal(codes.length, 8)
  assert.equal(new Set(codes).size, 8)
  assert.ok(codes.every((code: string) => /^(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/.test(code)))
  const stored = await source.query('SELECT code_hash FROM user_recovery_codes WHERE user_id=?', [first.user.id])
  assert.equal(JSON.stringify(stored).includes(codes[0].replaceAll('-', '')), false)
  const status = await call('GET', '/recovery-codes', first.token)
  assert.equal(status.remaining, 8)
  assert.equal('codes' in status, false)
  await call('POST', '/password-recovery', '', { username: foreign.user.username, recoveryCode: codes[0], newPassword: 'new123' }, 400)
  const attempts = await Promise.all([0, 1].map(() => app.inject({ method: 'POST', url: '/api/v1/auth/password-recovery', payload: { username, recoveryCode: codes[0], newPassword: 'new123' } })))
  assert.deepEqual(attempts.map((result) => result.statusCode).sort(), [204, 400], 'A recovery code is single-use under concurrent requests')
  await call('GET', '/me', first.token, undefined, 401)
  const restored = await call('POST', '/login', '', { username, password: 'new123' })
  assert.equal((await call('GET', '/recovery-codes', restored.token)).remaining, 7)
  await call('POST', '/recovery-codes', restored.token, { currentPassword: 'new123' })
  await call('POST', '/password-recovery', '', { username, recoveryCode: codes[1], newPassword: 'next12' }, 400)
  console.log('Account security integration passed: opaque device sessions, ownership/revocation, password-confirmed hashed recovery codes, concurrent single use, session invalidation and regeneration')
} finally {
  await app.close()
  await cleanupUsers(source, users)
  await source.destroy()
}
