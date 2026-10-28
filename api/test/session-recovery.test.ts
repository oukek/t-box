import type { BillRepository } from '@t-box/ledger-server/repository'
import type { ChatMessage, ChatServerEvent } from '@t-box/shared'
import type { ChatSession } from '../src/chat/session.js'
import type { PlatformService } from '../src/platform/service.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { ApiError } from '@t-box/server-foundation/errors'

import { ApplicationChatService as ChatService } from '../src/bootstrap/chat.js'
import { MemorySessionRepository } from '../src/chat/session.js'
import { FixtureChatProvider } from './chat-provider-fixture.js'

function fixture() {
  const userId = randomUUID()
  const platform = {
    identity: {
      authenticate: async (token: string) => {
        if (token !== 'test-login') {
          throw new ApiError(401, 'UNAUTHENTICATED', '请登录')
        }
        return { user: { id: userId }, sessionHash: 'test-login-hash' }
      },
      authenticateHash: async () => {},
    },
  } as unknown as PlatformService
  return { platform, userId }
}
const bills = {} as BillRepository // Session handshakes must not touch finance.

test('desktop and phone independently open and synchronize the same completed conversation', async (t) => {
  const { platform, userId } = fixture()
  const conversationId = randomUUID()
  let revision = 1
  let messages: ChatMessage[] = []
  let authorize = true
  let refresh: Promise<void> | undefined
  Object.assign(platform, {
    tasks: { current: async () => null },
    conversations: {
      async restore(actor: { user: { id: string } }, id: string, session: ChatSession) {
        assert.equal(actor.user.id, userId)
        assert.equal(id, conversationId)
        if (!authorize) {
          throw new ApiError(423, 'LEDGER_LOCKED', '请重新授权')
        }
        await refresh
        Object.assign(session, { conversationId, userId, archived: true, archiveRevision: revision, messages: structuredClone(messages) })
      },
    },
  })
  const service = new ChatService({ bills, platform, provider: new FixtureChatProvider() })
  const desktop: ChatServerEvent[] = []
  const phone: ChatServerEvent[] = []
  const a = service.connect((event) => desktop.push(event))
  const b = service.connect((event) => phone.push(event))
  t.after(async () => {
    a.close()
    b.close()
    await service.close()
  })
  await Promise.all([a.receive({ type: 'session.open', authToken: 'test-login', conversationId }), b.receive({ type: 'session.open', authToken: 'test-login', conversationId })])
  assert.equal(desktop[0]?.type, 'session.ready')
  assert.equal(phone[0]?.type, 'session.ready')
  const sessions = [...service.sessions.all()]
  assert.equal(sessions.length, 2)
  assert.notEqual(sessions[0]!.id, sessions[1]!.id)
  assert.notEqual(sessions[0]!.owner, sessions[1]!.owner)
  assert.notEqual(sessions[0]!.token, sessions[1]!.token)

  messages = [{ id: randomUUID(), role: 'assistant', content: '另一设备完成的回答', toolCalls: [], createdAt: new Date().toISOString() }]
  revision++
  await b.receive({ type: 'ping' })
  const synced = phone.findLast((event) => event.type === 'session.snapshot')
  assert.equal(synced?.type, 'session.snapshot')
  if (synced?.type === 'session.snapshot') {
    assert.equal(synced.snapshot.messages[0]?.content, messages[0]!.content)
  }
  assert.equal(sessions[0]!.messages.length, 0, 'Each device refreshes its own authorized view')
  await a.receive({ type: 'ping' })
  assert.equal(sessions[0]!.messages[0]?.content, messages[0]!.content)
  assert.equal(sessions[1]!.task, null, 'Completed conversations still refresh without a current task')

  let finishRefresh!: () => void
  refresh = new Promise<void>((resolve) => {
    finishRefresh = resolve
  })
  const pending = b.receive({ type: 'ping' })
  await Promise.resolve()
  assert.equal(sessions[1]!.finishing, true)
  finishRefresh()
  await pending
  assert.equal(sessions[1]!.finishing, false)
  const snapshotCount = phone.filter((event) => event.type === 'session.snapshot').length
  authorize = false
  messages[0]!.content = '授权撤销后不可泄露的内容'
  await b.receive({ type: 'ping' })
  assert.equal(phone.filter((event) => event.type === 'session.snapshot').length, snapshotCount)
  assert.equal(JSON.stringify(phone).includes('授权撤销后不可泄露的内容'), false)
})

test('authenticated blank chat gets a fresh transport after restart or idle expiry', async (t) => {
  for (const reason of ['restart', 'expiry'] as const) {
    await t.test(reason, async (t) => {
      let now = 0
      const sessions = new MemorySessionRepository(10, 100, () => now)
      const { platform, userId } = fixture()
      const service = new ChatService({
        bills,
        platform,
        sessions,
        provider: new FixtureChatProvider(),
      })
      const events: ChatServerEvent[] = []
      const first = service.connect((event) => events.push(event))
      await first.receive({ type: 'session.open', authToken: 'test-login' })
      const ready = events[0]
      assert.equal(ready?.type, 'session.ready')
      if (ready?.type !== 'session.ready') {
        throw new Error('Expected ready')
      }
      first.close()
      if (reason === 'restart') {
        sessions.clear()
      } else {
        now = 11
      }
      const resumed = service.connect((event) => events.push(event))
      t.after(async () => {
        resumed.close()
        await service.close()
      })
      await resumed.receive({
        type: 'session.open',
        authToken: 'test-login',
        sessionId: ready.snapshot.sessionId,
        token: ready.token,
      })
      const fresh = events.at(-1)
      assert.equal(fresh?.type, 'session.ready')
      if (fresh?.type !== 'session.ready') {
        throw new Error('Expected fresh ready')
      }
      assert.equal(fresh.restored, false)
      assert.notEqual(fresh.snapshot.sessionId, ready.snapshot.sessionId)
      assert.deepEqual(fresh.snapshot.messages, [])
      assert.equal(fresh.snapshot.activeRun, null)
      assert.equal(fresh.snapshot.conversationId, undefined)
      assert.equal([...sessions.all()][0]?.userId, userId)
      assert.equal(
        events.some(
          (event) =>
            event.type === 'run.started' || event.type === 'tool.request',
        ),
        false,
      )
    })
  }
})

test('transport recovery still rejects invalid login and wrong credentials for a live session', async (t) => {
  const { platform } = fixture()
  const service = new ChatService({
    bills,
    platform,
    provider: new FixtureChatProvider(),
  })
  const connections: ReturnType<ChatService['connect']>[] = []
  t.after(async () => {
    connections.forEach((connection) => connection.close())
    await service.close()
  })
  async function open(event: unknown) {
    const events: ChatServerEvent[] = []
    const connection = service.connect((event) => events.push(event))
    connections.push(connection)
    await connection.receive(event)
    return { event: events.at(-1), connection }
  }
  const unauthenticated = await open({
    type: 'session.open',
    authToken: 'wrong-login',
    sessionId: randomUUID(),
    token: 'old-token',
  })
  assert.equal(unauthenticated.event?.type, 'error')
  if (unauthenticated.event?.type === 'error') {
    assert.equal(unauthenticated.event.code, 'UNAUTHENTICATED')
  }
  assert.equal([...service.sessions.all()].length, 0)
  const first = await open({ type: 'session.open', authToken: 'test-login' })
  assert.equal(first.event?.type, 'session.ready')
  if (first.event?.type !== 'session.ready') {
    throw new Error('Expected ready')
  }
  first.connection.close()
  const invalid = await open({
    type: 'session.open',
    authToken: 'test-login',
    sessionId: first.event.snapshot.sessionId,
    token: 'wrong-transport-token',
  })
  assert.equal(invalid.event?.type, 'error')
  if (invalid.event?.type === 'error') {
    assert.equal(invalid.event.code, 'SESSION_INVALID')
  }
  assert.equal([...service.sessions.all()].length, 1)
})

test('expired transport cannot bypass archive ownership or ledger access checks', async (t) => {
  const platform = {
    ...fixture().platform,
    conversations: {
      restore: async () => {
        throw new ApiError(423, 'LEDGER_LOCKED', '请解锁历史账本')
      },
    },
  } as unknown as PlatformService
  const service = new ChatService({
    bills,
    platform,
    provider: new FixtureChatProvider(),
  })
  const events: ChatServerEvent[] = []
  const connection = service.connect((event) => events.push(event))
  t.after(async () => {
    connection.close()
    await service.close()
  })
  await connection.receive({
    type: 'session.open',
    authToken: 'test-login',
    sessionId: randomUUID(),
    token: 'expired-token',
    conversationId: randomUUID(),
  })
  assert.equal(events[0]?.type, 'error')
  if (events[0]?.type === 'error') {
    assert.equal(events[0].code, 'LEDGER_LOCKED')
  }
  assert.equal([...service.sessions.all()].length, 0)
})
