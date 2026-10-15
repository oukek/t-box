import type { ApplicationModule, ApplicationToolContext } from '@t-box/app-server-sdk'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bindRemoteTools, createApplicationBackendHandler } from '@t-box/app-server-sdk'

test('remote preflight completes client interactions before dispatch and keeps tickets out of model arguments', async () => {
  const module: ApplicationModule = {
    id: 'fixture',
    contractVersion: '1.0',
    skills: {},
    interactions: [{ name: 'fixture.authorize', title: '授权', description: '测试授权', purpose: 'authorization', inputSchema: {} }],
    tools: { fixture_write: { definition: { type: 'function', name: 'fixture_write', parameters: {}, strict: true }, title: '测试', execution: 'server', effect: 'write', successSummary: '完成', handler: async () => null } },
  }
  const createContext = (available: boolean) => {
    const values = new Map<string, Promise<unknown>>()
    return {
      requestId: 'request',
      callId: 'call',
      application: { appId: 'fixture', releaseId: 'v1', generation: 1 },
      signal: new AbortController().signal,
      bindings: [],
      session: { messages: [] },
      interact: async () => {
        if (!available) {
          throw new Error('CLIENT_REQUIRED')
        }
        return { ok: true, data: { authorizationToken: 'app-scoped-short-lived-grant' } }
      },
      use<T>(key: string, factory: () => Promise<T>): Promise<T> {
        if (!values.has(key)) {
          values.set(key, factory())
        }
        return values.get(key) as Promise<T>
      },
    } as ApplicationToolContext
  }
  let writes = 0
  let preparationCalls = 0
  let undeclared = false
  const bound = bindRemoteTools(module, { fixture_write: 'write' }, {
    prepare: async (input) => {
      preparationCalls++
      assert.equal(input.invocation.invocationId, 'call')
      if (!input.continuation) {
        return { status: 'interaction', continuation: 'opaque-continuation', request: { name: undeclared ? 'other.authorize' : 'fixture.authorize', arguments: { resourceId: 'test' } } }
      }
      assert.equal(input.continuation, 'opaque-continuation')
      assert.deepEqual(input.response, { ok: true, data: { authorizationToken: 'app-scoped-short-lived-grant' } })
      return { status: 'ready', ticket: 'opaque-bound-execution-ticket' }
    },
    invoke: async (input) => {
      writes++
      assert.equal(input.preparationTicket, 'opaque-bound-execution-ticket')
      assert.deepEqual(input.arguments, { amount: 1 })
      return { saved: true }
    },
  }).tools.fixture_write!
  await assert.rejects(bound.validate!({ amount: 1 }, createContext(false)), /CLIENT_REQUIRED/)
  assert.equal(writes, 0, 'No dispatch occurs while waiting for a frontend')
  const resumed = createContext(true)
  await bound.validate!({ amount: 1 }, resumed)
  assert.equal(writes, 0)
  assert.deepEqual(await bound.handler!({ amount: 1 }, resumed), { saved: true })
  assert.equal(preparationCalls, 3, 'Handler reuses preparation within this execution only')
  assert.equal(writes, 1)
  undeclared = true
  await assert.rejects(bound.validate!({}, createContext(true)), /undeclared/)
  assert.equal(writes, 1)
})

test('portable backend authenticates preparation and events without exposing host bearer credentials', async () => {
  const appId = 'fixture'
  const subject = 'a'.repeat(64)
  const base = { appId, subject, releaseId: 'v1', generation: 1 }
  const handler = createApplicationBackendHandler({ appId, credential: 'service-only', backend: {
    lifecycle: async () => ({ status: 'pending' }),
    operation: async () => null,
    invoke: async () => ({}),
    prepare: async (input) => {
      assert.equal(input.invocation.subject, subject)
      return { status: 'ready', ticket: 'opaque' }
    },
    events: async (input) => {
      assert.equal(input.cursor, 'cursor-1')
      return { cursor: 'cursor-2', events: [{ type: 'changed', id: 'public-id' }] }
    },
  } })
  const call = (path: string, value: unknown, credential = 'service-only') => handler(new Request(`https://backend.test${path}`, { method: 'POST', headers: { authorization: `Bearer ${credential}` }, body: JSON.stringify(value) }))
  assert.equal((await call('/prepare', {}, 'host-user-token')).status, 401)
  assert.equal((await call('/prepare', { invocation: { ...base, appId: 'other', invocationId: 'call', method: 'write' } })).status, 400)
  assert.deepEqual(await (await call('/prepare', { invocation: { ...base, invocationId: 'call', method: 'write' } })).json(), { status: 'ready', ticket: 'opaque' })
  assert.deepEqual(await (await call('/events/poll', { ...base, channel: 'changed', cursor: 'cursor-1' })).json(), { cursor: 'cursor-2', events: [{ type: 'changed', id: 'public-id' }] })
})
