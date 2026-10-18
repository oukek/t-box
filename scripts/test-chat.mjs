#!/usr/bin/env node
/**
 * Real WebSocket + REST integration checks against an isolated API with a test provider.
 * Run: node scripts/test-chat.mjs
 * Optional: TBOX_TEST_API_URL=http://127.0.0.1:3000/api/v1
 *           TBOX_TEST_WS_URL=ws://127.0.0.1:5173/api/v1/chat/ws
 *           TBOX_TEST_ORIGIN=http://127.0.0.1:5173
 * Creates uniquely marked bills and deletes only those records in finally.
 */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

if (process.argv.includes('--help')) {
  console.log('Run pnpm test:chat to start an isolated fixture API.')
  console.log(
    'Optional variables: TBOX_TEST_API_URL, TBOX_TEST_WS_URL, TBOX_TEST_ORIGIN.',
  )
  process.exit(0)
}

const apiRequire = createRequire(
  new URL('../api/package.json', import.meta.url),
)
let WebSocket
try {
  WebSocket = apiRequire('ws')
} catch {
  // pnpm keeps transitive dependencies private to their owning package.
  WebSocket = createRequire(apiRequire.resolve('@fastify/websocket'))('ws')
}

const apiBase = new URL(
  process.env.TBOX_TEST_API_URL ?? 'http://127.0.0.1:3000/api/v1',
)
assert.ok(
  ['http:', 'https:'].includes(apiBase.protocol),
  'API URL must use HTTP(S).',
)
assert.ok(
  !apiBase.username && !apiBase.password && !apiBase.search,
  'Do not put credentials in the test URL.',
)
apiBase.pathname = apiBase.pathname.replace(/\/+$/, '')
const websocketUrl = new URL(
  process.env.TBOX_TEST_WS_URL ?? `${apiBase.href}/chat/ws`,
)
if (websocketUrl.protocol === 'http:') {
  websocketUrl.protocol = 'ws:'
}
if (websocketUrl.protocol === 'https:') {
  websocketUrl.protocol = 'wss:'
}
assert.ok(
  ['ws:', 'wss:'].includes(websocketUrl.protocol),
  'WebSocket URL must use WS(S).',
)
assert.ok(
  !websocketUrl.username && !websocketUrl.password,
  'Do not put credentials in the WebSocket URL.',
)
const origin = process.env.TBOX_TEST_ORIGIN ?? 'http://127.0.0.1:5173'
const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
}).format(new Date())
// Demo mode deliberately rejects more than one number in a recording request.
const suffix = randomBytes(12)
  .toString('hex')
  .replace(/\d/g, (digit) => String.fromCharCode(103 + Number(digit)))
const marker = `WS回归${suffix}`
const amount = '12.37'
const createdIds = new Set()
const ownedRequests = new Set()
const ownedRuns = new Set()
const clients = new Set()
const authToken = process.env.TBOX_TEST_TOKEN
const ledgerId = process.env.TBOX_TEST_LEDGER_ID
assert.ok(
  authToken && ledgerId,
  'Use pnpm test:chat for an isolated authenticated fixture.',
)
const billBase = `/ledgers/${ledgerId}/bills`
let markerSubmitted = false
let checks = 0

function passed(label) {
  checks += 1
  console.log(`✓ ${label}`)
}

async function rest(path, options = {}) {
  const response = await fetch(`${apiBase.href}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Idempotency-Key': randomUUID(),
      ...options.headers,
    },
    signal: AbortSignal.timeout(8_000),
  })
  const body = response.status === 204 ? undefined : await response.json()
  return { response, body }
}

async function checkOriginAccepted(originValue) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl, {
      ...(originValue ? { headers: { Origin: originValue } } : {}),
      handshakeTimeout: 8_000,
    })
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error('Open-origin authentication check timed out.'))
    }, 8_000)
    socket.once('open', () => {
      socket.send(JSON.stringify({ type: 'session.open', authToken: 'invalid-origin-test-token' }))
    })
    socket.once('message', (data) => {
      clearTimeout(timer)
      socket.close()
      try {
        const event = JSON.parse(data.toString())
        assert.equal(event.type, 'error')
        assert.equal(event.code, 'UNAUTHENTICATED')
        resolve()
      } catch (error) {
        reject(error)
      }
    })
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer)
      response.resume()
      socket.terminate()
      reject(new Error(`Expected an open-origin WebSocket upgrade; got HTTP ${response.statusCode}.`))
    })
    // Termination after unexpected-response also emits an error event.
    socket.on('error', () => {})
  })
}

class ChatConnection {
  events = []
  waiters = new Set()
  socket

  async connect() {
    this.socket = new WebSocket(websocketUrl, {
      headers: { Origin: origin },
      handshakeTimeout: 8_000,
    })
    clients.add(this)
    this.socket.on('message', (raw) => {
      let event
      try {
        event = JSON.parse(raw.toString())
      } catch {
        this.rejectWaiters(new Error('The server sent a non-JSON message.'))
        return
      }
      this.events.push(event)
      if (
        event.type === 'run.started' &&
        ownedRequests.has(event.run.requestId)
      ) {
        ownedRuns.add(event.run.id)
      }
      if (
        event.type === 'tool.request' &&
        event.name === 'app_open' &&
        ownedRuns.has(event.runId)
      ) {
        const id = event.arguments?.params?.billId
        if (typeof id === 'string') {
          createdIds.add(id)
        }
      }
      for (const waiter of [...this.waiters]) {
        waiter.check()
      }
    })
    this.socket.on('close', () =>
      this.rejectWaiters(
        new Error('WebSocket closed before the expected event.'),
      ))
    this.socket.on('error', () =>
      this.rejectWaiters(new Error('WebSocket connection failed.')))
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve)
      this.socket.once('error', () =>
        reject(new Error('Cannot connect to the chat WebSocket.')))
      this.socket.once('unexpected-response', (_request, response) => {
        reject(
          new Error(`WebSocket upgrade rejected: HTTP ${response.statusCode}.`),
        )
      })
    })
    return this
  }

  rejectWaiters(error) {
    for (const waiter of [...this.waiters]) {
      waiter.reject(error)
    }
  }

  mark() {
    return this.events.length
  }

  send(event) {
    if (event.type === 'session.open') {
      event = { ...event, authToken }
    }
    if (event.type === 'message.send') {
      event = { ...event, ledgerId }
    }
    this.socket.send(JSON.stringify(event))
  }

  wait(predicate, after = 0, timeout = 15_000) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        // eslint-disable-next-line no-use-before-define -- Waiter callbacks run after both bindings are initialized.
        clearTimeout(timer)
        // eslint-disable-next-line no-use-before-define -- Cleanup is shared by the waiter and its timeout.
        this.waiters.delete(waiter)
      }
      const waiter = {
        check: () => {
          const event = this.events.slice(after).find(predicate)
          if (event) {
            cleanup()
            resolve(event)
          }
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
      }
      const timer = setTimeout(() => {
        const eventTypes = this.events
          .slice(after)
          .map((event) => event.type)
          .join(', ')
        const execution = this.events.slice(after).flatMap((event) => {
          if (event.type === 'tool.update') {
            return [{ tool: event.tool.name, status: event.tool.status, summary: event.tool.summary }]
          }
          if (event.type === 'run.finished') {
            return [{ finished: event.status }]
          }
          return []
        })
        waiter.reject(
          new Error(
            `Timed out waiting for a chat event. Received event types: ${eventTypes || 'none'}. Execution: ${JSON.stringify(execution)}.`,
          ),
        )
      }, timeout)
      this.waiters.add(waiter)
      waiter.check()
    })
  }

  async exchange(event, predicate, timeout) {
    const after = this.mark()
    this.send(event)
    return this.wait(predicate, after, timeout)
  }

  async close() {
    if (this.socket?.readyState === WebSocket.CLOSED) {
      return
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.socket.terminate()
        resolve()
      }, 1_000)
      this.socket.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      this.socket.close()
    })
  }
}

async function listOwnBills() {
  const params = new URLSearchParams({
    q: marker,
    month: localDate.slice(0, 7),
    pageSize: '100',
  })
  const { response, body } = await rest(`${billBase}?${params}`)
  assert.equal(response.status, 200, 'The bill list API must be available.')
  assert.ok(Array.isArray(body.data), 'Bill list response must contain data.')
  return body.data.filter(
    (bill) =>
      bill.note.includes(marker) &&
      bill.date === localDate &&
      bill.amount === amount &&
      bill.type === 'expense',
  )
}

async function run() {
  const health = await rest('/health')
  assert.equal(
    health.response.status,
    200,
    'Start the API with its database available before testing.',
  )
  await checkOriginAccepted('https://new-client.invalid')
  await checkOriginAccepted(undefined)
  passed('Arbitrary or missing WebSocket origins connect, but invalid account credentials remain rejected')
  const client = await new ChatConnection().connect()
  const ready = await client.exchange(
    { type: 'session.open' },
    (event) => event.type === 'session.ready',
  )
  assert.equal(
    ready.snapshot.mode,
    'openai',
    'Integration checks use the isolated fixture provider; no paid requests are made.',
  )
  assert.equal(ready.snapshot.activeRun, null)
  assert.equal(ready.snapshot.messages.length, 0)
  await client.exchange({ type: 'ping' }, (event) => event.type === 'pong')
  passed('Session handshake and heartbeat')

  const connectionInUse = await new ChatConnection().connect()
  const inUse = await connectionInUse.exchange(
    {
      type: 'session.open',
      sessionId: ready.snapshot.sessionId,
      token: ready.token,
    },
    (event) => event.type === 'error',
  )
  assert.equal(inUse.code, 'SESSION_IN_USE')
  await connectionInUse.close()
  passed('An active session cannot be taken over by another socket')

  const invalidCredentials = await new ChatConnection().connect()
  const unauthorized = await invalidCredentials.exchange(
    {
      type: 'session.open',
      sessionId: ready.snapshot.sessionId,
      token: 'invalid-test-token',
    },
    (event) => event.type === 'error',
  )
  assert.equal(unauthorized.code, 'SESSION_INVALID')
  assert.ok(
    !invalidCredentials.events.some((event) => event.type === 'session.ready'),
  )
  await invalidCredentials.close()
  passed(
    'A session ID without its matching token cannot restore conversation history',
  )

  const requestId = randomUUID()
  ownedRequests.add(requestId)
  const request = {
    type: 'message.send',
    requestId,
    text: `买菜 ${amount} 备注：${marker}`,
    localDate,
  }
  const startMark = client.mark()
  markerSubmitted = true
  client.send(request)
  const started = await client.wait(
    (event) =>
      event.type === 'run.started' && event.run.requestId === requestId,
    startMark,
  )
  const openApp = await client.wait(
    (event) => event.type === 'tool.request' && event.runId === started.run.id,
    startMark,
  )
  assert.equal(openApp.name, 'app_open')
  assert.equal(openApp.arguments.appId, 'ledger')
  assert.equal(openApp.arguments.params.month, localDate.slice(0, 7))
  assert.equal(typeof openApp.arguments.params.billId, 'string')
  const toolUpdates = client.events
    .slice(startMark)
    .filter((event) => event.type === 'tool.update')
  assert.ok(
    toolUpdates.some(
      (event) =>
        event.tool.name === 'skill_activate' &&
        event.tool.status === 'completed',
    ),
  )
  assert.ok(
    toolUpdates.some(
      (event) =>
        event.tool.name === 'bills_create' && event.tool.status === 'completed',
    ),
  )
  passed(
    'A recording request executes the skill and server tool, then requests app_open',
  )

  const pendingDuplicate = await client.exchange(
    request,
    (event) => event.type === 'session.snapshot',
  )
  assert.equal(pendingDuplicate.snapshot.activeRun?.id, started.run.id)
  assert.equal(
    pendingDuplicate.snapshot.messages.filter(
      (message) => message.role === 'user',
    ).length,
    1,
  )
  const invalidAck = await client.exchange(
    {
      type: 'tool.result',
      runId: randomUUID(),
      callId: openApp.callId,
      result: { ok: true },
    },
    (event) => event.type === 'error',
  )
  assert.equal(invalidAck.code, 'INVALID_TOOL_RESULT')
  const invalidCall = await client.exchange(
    {
      type: 'tool.result',
      runId: started.run.id,
      callId: randomUUID(),
      result: { ok: true },
    },
    (event) => event.type === 'error',
  )
  assert.equal(invalidCall.code, 'INVALID_TOOL_RESULT')
  const completed = await client.exchange(
    {
      type: 'tool.result',
      runId: started.run.id,
      callId: openApp.callId,
      result: { ok: true, data: { appId: 'ledger' } },
    },
    (event) => event.type === 'run.finished' && event.runId === started.run.id,
  )
  assert.equal(completed.status, 'completed')
  assert.equal(completed.snapshot.activeRun, null)
  assert.ok(
    completed.snapshot.messages.some(
      (message) => message.role === 'assistant' && message.content.length > 0,
    ),
  )
  passed(
    'Invalid client acknowledgements are rejected; the matching acknowledgement completes the run',
  )

  const duplicate = await client.exchange(
    request,
    (event) => event.type === 'session.snapshot',
  )
  assert.equal(duplicate.snapshot.activeRun, null)
  for (const conflicting of [
    { ...request, text: `午餐 ${amount} 备注：${marker}` },
    { ...request, localDate: '2000-01-01' },
  ]) {
    const conflict = await client.exchange(
      conflicting,
      (event) => event.type === 'error',
    )
    assert.equal(conflict.code, 'REQUEST_ID_CONFLICT')
  }
  const ownBills = await listOwnBills()
  assert.equal(
    ownBills.length,
    1,
    'Retrying the same request must not create a second bill.',
  )
  assert.equal(ownBills[0].id, openApp.arguments.params.billId)
  const persisted = await rest(
    `${billBase}/${encodeURIComponent(openApp.arguments.params.billId)}`,
  )
  assert.equal(persisted.response.status, 200)
  assert.equal(persisted.body.data.amount, amount)
  assert.ok(persisted.body.data.note.includes(marker))
  passed(
    'REST confirms persistence; retries do not duplicate writes and conflicting request IDs are rejected',
  )

  const staleAck = await client.exchange(
    {
      type: 'tool.result',
      runId: started.run.id,
      callId: openApp.callId,
      result: { ok: true },
    },
    (event) => event.type === 'error',
  )
  assert.equal(staleAck.code, 'INVALID_TOOL_RESULT')
  const unknown = await client.exchange(
    {
      type: 'tool.call',
      name: 'unknown_arbitrary_tool',
      arguments: { billId: openApp.arguments.params.billId },
    },
    (event) => event.type === 'error',
  )
  assert.ok(
    unknown.code,
    'An unknown client tool invocation must be rejected.',
  )
  assert.equal(
    (
      await rest(
        `${billBase}/${encodeURIComponent(openApp.arguments.params.billId)}`,
      )
    ).response.status,
    200,
  )
  passed(
    'Duplicate acknowledgements and unknown client tool events are rejected without changing the bill',
  )

  const cancelRequestId = randomUUID()
  ownedRequests.add(cancelRequestId)
  const cancelMark = client.mark()
  client.send({
    type: 'message.send',
    requestId: cancelRequestId,
    text: '打开记账',
    localDate,
  })
  const cancelRun = await client.wait(
    (event) =>
      event.type === 'run.started' && event.run.requestId === cancelRequestId,
    cancelMark,
  )
  const pendingTool = await client.wait(
    (event) =>
      event.type === 'tool.request' && event.runId === cancelRun.run.id,
    cancelMark,
  )
  assert.equal(pendingTool.name, 'app_open')
  assert.equal(
    pendingTool.arguments.params.billId,
    undefined,
    'Cancellation check must not create another bill.',
  )
  const cancelled = await client.exchange(
    { type: 'run.cancel', runId: cancelRun.run.id },
    (event) =>
      event.type === 'run.finished' && event.runId === cancelRun.run.id,
  )
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.snapshot.activeRun, null)
  const lateAck = await client.exchange(
    {
      type: 'tool.result',
      runId: cancelRun.run.id,
      callId: pendingTool.callId,
      result: { ok: true },
    },
    (event) => event.type === 'error',
  )
  assert.equal(lateAck.code, 'INVALID_TOOL_RESULT')
  passed(
    'Cancelling a pending client tool clears the run and rejects a late acknowledgement',
  )

  const ambiguousRequestId = randomUUID()
  ownedRequests.add(ambiguousRequestId)
  const ambiguousMark = client.mark()
  client.send({
    type: 'message.send',
    requestId: ambiguousRequestId,
    text: `不要记账；买菜 ${amount} 备注：${marker}`,
    localDate,
  })
  const ambiguousRun = await client.wait(
    (event) =>
      event.type === 'run.started' &&
      event.run.requestId === ambiguousRequestId,
    ambiguousMark,
  )
  const ambiguousFinished = await client.wait(
    (event) =>
      event.type === 'run.finished' && event.runId === ambiguousRun.run.id,
    ambiguousMark,
  )
  assert.equal(ambiguousFinished.status, 'completed')
  assert.ok(
    !client.events
      .slice(ambiguousMark)
      .some(
        (event) =>
          event.type === 'tool.update' && event.tool.name === 'bills_create',
      ),
  )
  passed(
    'A negated or unsupported recording request does not execute a write tool',
  )

  const failedOpenRequestId = randomUUID()
  ownedRequests.add(failedOpenRequestId)
  const failedOpenMark = client.mark()
  client.send({
    type: 'message.send',
    requestId: failedOpenRequestId,
    text: '打开记账',
    localDate,
  })
  const failedOpenRun = await client.wait(
    (event) =>
      event.type === 'run.started' &&
      event.run.requestId === failedOpenRequestId,
    failedOpenMark,
  )
  const failedOpenTool = await client.wait(
    (event) =>
      event.type === 'tool.request' && event.runId === failedOpenRun.run.id,
    failedOpenMark,
  )
  const failedOpen = await client.exchange(
    {
      type: 'tool.result',
      runId: failedOpenRun.run.id,
      callId: failedOpenTool.callId,
      result: {
        ok: false,
        error: { code: 'CLIENT_REFUSED', message: '客户端回归测试拒绝打开' },
      },
    },
    (event) =>
      event.type === 'run.finished' && event.runId === failedOpenRun.run.id,
  )
  const failedOpenMessage = failedOpen.snapshot.messages.find(
    (message) => message.id === failedOpenRun.run.assistantMessageId,
  )
  assert.ok(failedOpenMessage?.content.includes('未能打开'))
  assert.ok(!failedOpenMessage.content.includes('应用已打开'))
  passed(
    'A failed client navigation is reported as a failure, without a false success claim',
  )

  await client.close()
  const restored = await new ChatConnection().connect()
  const restoreReady = await restored.exchange(
    {
      type: 'session.open',
      sessionId: ready.snapshot.sessionId,
      token: ready.token,
    },
    (event) => event.type === 'session.ready',
  )
  assert.equal(restoreReady.restored, true)
  assert.equal(restoreReady.snapshot.sessionId, ready.snapshot.sessionId)
  assert.equal(restoreReady.snapshot.activeRun, null)
  await restored.exchange(
    request,
    (event) => event.type === 'session.snapshot',
  )
  assert.equal((await listOwnBills()).length, 1)
  passed('Session restoration retains history and request deduplication')
}

let failure
let cleanedUp = 0
try {
  await run()
} catch (error) {
  failure = error
} finally {
  await Promise.allSettled([...clients].map((client) => client.close()))
  if (markerSubmitted) {
    // A connection failure could hide app_open after a successful INSERT.
    // Recover only this run's exact marker, date, type and amount before deleting.
    try {
      for (const bill of await listOwnBills()) {
        createdIds.add(bill.id)
      }
    } catch (error) {
      failure ??= error
      console.error(
        `Could not recover test records for cleanup marker ${marker}.`,
      )
    }
  }
  for (const id of createdIds) {
    try {
      const current = await rest(`${billBase}/${encodeURIComponent(id)}`)
      if (current.response.status === 404) {
        cleanedUp += 1
        continue
      }
      assert.equal(current.response.status, 200)
      assert.ok(
        current.body.data.note.includes(marker),
        'Refusing to delete a bill without this test’s unique marker.',
      )
      assert.equal(current.body.data.amount, amount)
      assert.equal(current.body.data.date, localDate)
      const removed = await rest(`${billBase}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      assert.ok(
        [204, 404].includes(removed.response.status),
        'Could not clean up a test bill.',
      )
      cleanedUp += 1
    } catch (error) {
      failure ??= error
      console.error(`Could not clean up test bill ${id}.`)
    }
  }
  if (markerSubmitted && cleanedUp) {
    console.log(`Cleaned up ${cleanedUp} uniquely marked test bill(s).`)
  }
}

if (failure) {
  console.error(`Chat integration check failed: ${failure.message}`)
  process.exitCode = 1
} else {
  console.log(`Passed ${checks} chat integration checks.`)
}
