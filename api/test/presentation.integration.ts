import type { ChatServerEvent } from '@t-box/shared'
import type { ChatProvider } from '../src/chat/provider.js'
/** Disposable database identities and a fake provider; no paid model calls. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { createApp } from '../src/app.js'
import { ApplicationChatService } from '../src/bootstrap/chat.js'
import { MemorySessionRepository } from '../src/chat/session.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const p = new PlatformService(source)
const users: string[] = []
let titles = 0
const provider: ChatProvider = {
  mode: 'openai',
  configurationKey: 'presentation-fixture',
  async title(input) {
    assert.equal(input.text, '帮我安排周末旅行')
    titles++
    return '周末旅行计划'
  },
  async next(input) {
    await input.onUsage?.({
      inputTokens: 120,
      outputTokens: 30,
      cachedInputTokens: 80,
      reasoningTokens: 10,
      responseId: 'private-response-fixture',
      durationMs: 25,
    })
    input.onReasoning?.('summary:0', '整理出行要求', true)
    input.onDelta('建议先确定目的地。', 'reply:0')
    return {
      calls: [],
      output: [
        {
          type: 'reasoning',
          id: 'summary',
          summary: [{ type: 'summary_text', text: '整理出行要求' }],
          encrypted_content: 'opaque-fixture',
        },
        {
          type: 'message',
          id: 'reply',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: '建议先确定目的地。',
              annotations: [],
            },
          ],
        },
      ],
    }
  },
}
const service = new ApplicationChatService({
  platform: p,
  provider,
  bills: createBillRepository(source),
})
const app = createApp({
  platform: p,
  chatProvider: provider,
  bills: createBillRepository(source),
  health: async () => ({ mysql: 'up', redis: 'disabled' }),
})
try {
  const login = await p.identity.register(
    {
      username: `presentation_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
      nickname: '会话测试',
    },
    'presentation-fixture',
  )
  users.push(login.user.id)
  const stranger = await p.identity.register(
    {
      username: `presentation_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
      nickname: '会话测试',
    },
    'presentation-fixture-other',
  )
  users.push(stranger.user.id)
  const actor = await p.identity.authenticate(login.token)
  const other = await p.identity.authenticate(stranger.token)
  const events: ChatServerEvent[] = []
  const connection = service.connect((e) => events.push(structuredClone(e)))
  await connection.receive({ type: 'session.open', authToken: login.token })
  await connection.receive({
    type: 'message.send',
    requestId: randomUUID(),
    text: '帮我安排周末旅行',
    localDate: '2026-10-06',
  })
  const until = async (check: () => boolean) => {
    const end = Date.now() + 5000
    while (!check()) {
      if (Date.now() > end) {
        throw new Error('Missing presentation event')
      }
      await new Promise((r) => setTimeout(r, 5))
    }
  }
  await until(() => events.some((e) => e.type === 'run.finished'))
  const final = events.find((e) => e.type === 'run.finished')!
  assert.equal(final.status, 'completed')
  const execution = final.snapshot.messages.at(-1)!.execution!
  assert.ok(execution.startedAt && execution.finishedAt)
  assert.equal(execution.activeSince, undefined)
  assert.ok(execution.durationMs >= 0)
  const started = events.find((e) => e.type === 'run.started')
  assert.ok(
    started?.type === 'run.started' &&
    started.assistantMessage.execution?.activeSince,
  )
  const usage = final.snapshot.messages.at(-1)!.usage!
  assert.equal(usage.totalTokens, 150)
  assert.equal(usage.calls.length, 1)
  assert.equal(usage.cachedInputTokens, 80)
  assert.equal(usage.reasoningTokens, 10)
  assert(
    events.some(
      (e) => e.type === 'message.usage' && e.usage.totalTokens === 150,
    ),
  )
  assert(!JSON.stringify(usage).includes('private-response-fixture'))
  assert.equal(titles, 1)
  assert.equal(final.snapshot.title, '周末旅行计划')
  assert.ok(
    events.some(
      (e) => e.type === 'conversation.title' && e.title === '周末旅行计划',
    ),
  )
  const id = final.snapshot.conversationId!
  assert.deepEqual(
    (await p.conversations.load(actor, id)).messages.at(-1)!.timeline!.map((x) => x.kind),
    ['reasoning', 'answer'],
  )
  const restored = new MemorySessionRepository().create()
  restored.userId = actor.user.id
  await p.conversations.restore(actor, id, restored)
  assert.equal(restored.title, '周末旅行计划')
  assert.deepEqual(restored.messages.at(-1)!.usage, usage)
  assert.deepEqual(restored.messages.at(-1)!.execution, execution)
  assert.equal(restored.messages.at(-1)!.outcome, 'completed')
  connection.close()
  await service.close()
  console.log(
    'PASS: first completed conversation generates and streams a title; ordered public progress survives archive restoration.',
  )
  const headers = { authorization: `Bearer ${login.token}` }
  for (const body of [
    { title: '' },
    { title: 'x'.repeat(61) },
    { title: 'a\nb' },
    { title: 'ok', unknown: true },
  ]) {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/conversations/${id}`,
      headers,
      payload: body,
    })
    assert.equal(res.statusCode, 400)
  }
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/conversations/${id}`,
        headers: { authorization: `Bearer ${stranger.token}` },
        payload: { title: '别人的标题' },
      })
    ).statusCode,
    404,
  )
  const revision = restored.archiveRevision
  const rename = await app.inject({
    method: 'PATCH',
    url: `/api/v1/conversations/${id}`,
    headers,
    payload: { title: '我的周末' },
  })
  assert.equal(rename.statusCode, 200, rename.body)
  assert.equal(
    await p.conversations.setGeneratedTitle(actor, id, '延迟自动标题'),
    '我的周末',
  )
  await p.conversations.save(restored)
  assert.equal(restored.title, '我的周末')
  assert.equal(
    restored.archiveRevision,
    revision! + 1,
    'metadata rename does not invalidate execution revisions',
  )
  assert.equal(await p.conversations.needsTitle(actor, id), false)
  assert.equal(
    (await p.conversations.list(actor)).find((x) => x.id === id)!.title,
    '我的周末',
  )
  assert.ok(!(await p.conversations.list(other)).some((x) => x.id === id))
  console.log(
    'PASS: manual titles win over delayed generation/stale saves; REST enforces validation and ownership without invalidating task revisions.',
  )
  const book = (await p.ledgers.list(actor))[0]!
  restored.messages.at(-1)!.resourceRefs = [
    { appId: 'ledger', resourceType: 'book', resourceId: book.id },
  ]
  await p.conversations.save(restored)
  await p.ledgers.password(actor, book.id, {
    password: 'test123',
    accountPassword: 'test123',
  })
  await p.ledgers.lock(actor, book.id)
  const denied = await app.inject({
    method: 'PATCH',
    url: `/api/v1/conversations/${id}`,
    headers,
    payload: { title: '锁定后的改名' },
  })
  assert.equal(denied.statusCode, 423, denied.body)
  assert.equal(
    (await p.conversations.list(actor)).find((x) => x.id === id)!.title,
    '受保护的会话',
  )
  console.log(
    'PASS: renaming protected history requires a current resource grant; titles are hidden while locked.',
  )
} finally {
  await service.close()
  await app.close()
  await cleanupUsers(source, users)
  await source.destroy()
}
