import type { ChatMessage, ChatServerEvent } from '@t-box/shared'
import type { Actor } from '../src/agent/contracts.js'
import type { ChatProvider } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { ApiError } from '@t-box/server-foundation/errors'
import { createConnection } from 'mysql2/promise'
import { createApp } from '../src/app.js'
import { MeteredChatProvider } from '../src/billing/provider.js'
import { ApplicationChatService } from '../src/bootstrap/chat.js'
import { MemorySessionRepository } from '../src/chat/session.js'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { initializeDatabase } from '../src/db/initialize.js'
import { ConversationEntity } from '../src/db/records/conversations-entities.js'
import {
  MemoryEntity,
  MemoryJobEntity,
} from '../src/db/records/memory-entities.js'
import { databaseSchemas } from '../src/db/schema/index.js'
import { MemoryWorker } from '../src/memory/worker.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

// A live development worker must never claim fixture jobs or call a real model.
const { database: _database, ...mysql } = getConfig().mysql
const fixtureDatabase = `t_box_test_memory_${randomUUID().replaceAll('-', '')}`
const admin = await createConnection(mysql)
await admin.query(
  `CREATE DATABASE \`${fixtureDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
)
const source = await createDataSource({
  ...mysql,
  database: fixtureDatabase,
}).initialize()
const platform = new PlatformService(source)
const ids: string[] = []
const app = createApp({
  platform,
  bills: createBillRepository(source),
  health: async () => ({ mysql: 'up', redis: 'disabled' }),
})
const memory = platform.memory
async function user() {
  const login = await platform.identity.register(
    {
      username: `mem_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
    },
    'memory-fixture',
  )
  ids.push(login.user.id)
  return {
    actor: await platform.identity.authenticate(login.token),
    headers: { authorization: `Bearer ${login.token}` },
  }
}
const input = {
  label: '回答风格',
  content: '我喜欢简短回答。',
  kind: 'preference' as const,
  ttlDays: null,
}
async function conversation(actor: Actor, content: string, enabled = true) {
  const session = new MemorySessionRepository().create()
  session.userId = actor.user.id
  session.conversationId = randomUUID()
  const message: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    content,
    memoryEnabled: enabled,
    createdAt: new Date().toISOString(),
    toolCalls: [],
  }
  session.messages = [
    message,
    {
      id: randomUUID(),
      role: 'assistant',
      content: '收到。',
      createdAt: new Date().toISOString(),
      toolCalls: [],
      outcome: 'completed',
    },
  ]
  await platform.conversations.save(session)
  return { session, message }
}
try {
  await initializeDatabase(source, databaseSchemas)
  const a = await user()
  const b = await user()
  assert.equal((await memory.list(a.actor)).settings.autoExtract, false)
  const added = await memory.save(a.actor, input)
  assert.match(await memory.recall(a.actor, '你好', []), /简短回答/)
  assert.equal(await memory.recall(b.actor, '回答', []), '')
  await assert.rejects(memory.forget(b.actor, added.id), {
    code: 'MEMORY_NOT_FOUND',
  })
  const changed = await memory.save(
    a.actor,
    { ...input, content: '我希望回答详细一些。', version: added.version },
    added.id,
  )
  await assert.rejects(
    memory.save(a.actor, { ...input, version: added.version }, added.id),
    { code: 'MEMORY_CONFLICT' },
  )
  assert.equal(changed.id, added.id)
  assert.ok(!(await memory.recall(a.actor, '', [])).includes('简短回答'))
  const expiring = await memory.save(a.actor, {
    ...input,
    label: '阶段目标',
    kind: 'goal',
    ttlDays: 3,
  })
  const edited = await memory.save(
    a.actor,
    {
      label: '阶段目标',
      kind: 'goal',
      content: '新的内容',
      version: expiring.version,
    },
    expiring.id,
  )
  assert.equal(
    edited.expiresAt,
    expiring.expiresAt,
    'editing content must not extend expiry',
  )
  const metered = new MeteredChatProvider(
    {
      mode: 'openai',
      async next(request) {
        await request.onUsage?.({
          responseId: 'free-memory-fixture',
          inputTokens: 100000,
          outputTokens: 100000,
        })
        return { calls: [], output: [] }
      },
    },
    platform.billing,
    randomUUID(),
    { inputPrice: '1', outputPrice: '2', imagePrice: '0' },
  )
  const freeOperation = randomUUID()
  await metered.next({
    history: [],
    tools: [],
    instructions: '',
    localDate: '',
    signal: new AbortController().signal,
    onDelta() {},
    execution: {
      userId: a.actor.user.id,
      operationId: freeOperation,
      purpose: 'memory_extraction',
    },
  })
  const fee = (await platform.billing.records(a.actor.user.id)).find(
    (row) => row.id === freeOperation,
  )!
  assert.equal(fee.fee, '0.300000')
  assert.equal(fee.charged, '0.000000')
  assert.equal(fee.purpose, 'memory_extraction')
  assert.equal(
    (await platform.billing.wallet(a.actor.user.id)).balance,
    '0.000000',
  )
  const settings = (await memory.list(a.actor)).settings
  await memory.settings(a.actor, { ...settings, autoExtract: true })
  const c = await conversation(a.actor, '以后请优先用中文回复我。')
  const jobs = source.getRepository(MemoryJobEntity)
  const job = await jobs.findOneByOrFail({
    userId: a.actor.user.id,
    messageId: c.message.id,
  })
  await jobs.update(
    { id: job.id },
    { availableAt: new Date(Date.now() - 1000).toISOString() },
  )
  let attempts = 0
  const provider: ChatProvider = {
    mode: 'openai',
    configurationKey: 'memory-fixture',
    async next(request) {
      attempts++
      assert.equal(request.execution?.purpose, 'memory_extraction')
      assert.equal(request.tools.length, 1)
      if (attempts === 1) {
        throw new ApiError(502, 'PROVIDER_FAILED', '模型响应标识不一致')
      }
      return {
        output: [],
        calls: [
          {
            id: 'extract',
            name: 'memory_extract',
            arguments: JSON.stringify({
              items: [
                {
                  slot: 'preference.language',
                  label: '回复语言',
                  content: '用户偏好中文回复。',
                  kind: 'preference',
                  ttlDays: null,
                },
              ],
            }),
          },
        ],
      }
    },
  }
  const worker = new MemoryWorker(memory, provider)
  await worker.tick()
  assert.equal(attempts, 2)
  const candidate = (await memory.list(a.actor)).items.find(
    (item) => item.status === 'candidate',
  )!
  assert.ok(candidate)
  assert.ok(!(await memory.recall(a.actor, '语言', [])).includes('中文回复'))
  await memory.accept(a.actor, candidate.id, candidate.version)
  assert.match(await memory.recall(a.actor, '语言', []), /中文回复/)
  await platform.conversations.save(c.session)
  assert.equal(
    await jobs.countBy({ userId: a.actor.user.id }),
    1,
    'archive replay cannot re-extract completed source',
  )
  c.session.messages = []
  await platform.conversations.save(c.session)
  assert.equal(
    await source.getRepository(MemoryEntity).countBy({ id: candidate.id }),
    0,
    'deleting source removes its derived memory transactionally',
  )
  const off = await conversation(a.actor, '我喜欢蓝色', false)
  assert.equal(await jobs.countBy({ messageId: off.message.id }), 0)
  const protectedSource = await conversation(a.actor, '密码 123456')
  assert.equal(await jobs.countBy({ messageId: protectedSource.message.id }), 0)
  const pending = await conversation(a.actor, '以后使用深色主题。')
  await jobs.update(
    { messageId: pending.message.id },
    { availableAt: new Date(Date.now() - 1000).toISOString() },
  )
  let release: (() => void) | undefined
  let started: (() => void) | undefined
  const began = new Promise<void>((resolve) => {
    started = resolve
  })
  const delayed = new MemoryWorker(memory, {
    ...provider,
    next: async () => {
      started!()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return {
        output: [],
        calls: [
          {
            id: 'delayed',
            name: 'memory_extract',
            arguments: JSON.stringify({
              items: [
                {
                  slot: 'preference.theme',
                  label: '主题',
                  content: '用户喜欢深色。',
                  kind: 'preference',
                  ttlDays: null,
                },
              ],
            }),
          },
        ],
      }
    },
  })
  const running = delayed.tick()
  await began
  await memory.forget(a.actor, 'all')
  release!()
  await running
  assert.equal(
    (await memory.list(a.actor)).items.length,
    0,
    'forget wins over an in-flight extraction',
  )
  await platform.conversations.save(pending.session)
  assert.equal(
    await jobs.countBy({ userId: a.actor.user.id, status: 'queued' }),
    0,
    'tombstones prevent resurrection on later saves',
  )
  const fork = new MemorySessionRepository().create()
  fork.userId = a.actor.user.id
  fork.conversationId = randomUUID()
  fork.messages = structuredClone(pending.session.messages)
  await platform.conversations.save(fork)
  assert.equal(
    await jobs.countBy({ conversationId: fork.conversationId }),
    0,
    'forking old messages after forgetting cannot create fresh extraction jobs',
  )
  const api = await app.inject({
    method: 'GET',
    url: '/api/v1/ai/memories/',
    headers: a.headers,
  })
  assert.equal(api.statusCode, 200, api.body)
  assert.equal(api.headers['cache-control'], 'no-store')
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/v1/ai/memories/' }))
      .statusCode,
    401,
  )
  const old = await conversation(a.actor, '记住我是一个早起的人。')
  await memory.remember(
    a.actor,
    input,
    { conversationId: old.session.conversationId!, message: old.message },
    'call-one',
  )
  await memory.remember(
    a.actor,
    input,
    { conversationId: old.session.conversationId!, message: old.message },
    'call-one',
  )
  assert.equal(
    (await memory.list(a.actor)).items.filter(
      (item) => item.origin === 'conversation',
    ).length,
    1,
  )
  await platform.conversations.remove(a.actor, old.session.conversationId!)
  assert.equal((await memory.list(a.actor)).items.length, 0)
  const toolUser = await user()
  for (const approved of [false, true]) {
    let round = 0
    const events: ChatServerEvent[] = []
    const runtime = new ApplicationChatService({
      platform,
      bills: createBillRepository(source),
      provider: {
        mode: 'openai',
        async next() {
          if (round++ < 2) {
            const id = randomUUID()
            const args = JSON.stringify(input)
            return {
              calls: [{ id, name: 'memory_remember', arguments: args }],
              output: [
                {
                  type: 'function_call',
                  call_id: id,
                  name: 'memory_remember',
                  arguments: args,
                },
              ],
            }
          }
          return { calls: [], output: [{ role: 'assistant', content: '完成' }] }
        },
      },
    })
    const connection = runtime.connect((event) => events.push(event))
    const wait = async (predicate: () => boolean) => {
      const deadline = Date.now() + 10000
      while (!predicate()) {
        assert.ok(Date.now() < deadline, JSON.stringify(events.at(-1)))
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }
    try {
      // Register a dedicated token for the existing test actor without using credentials in model input.
      const tokenLogin = await platform.identity.login(
        { username: toolUser.actor.user.username, password: 'test123' },
        'memory-tool-fixture',
      )
      await connection.receive({
        type: 'session.open',
        authToken: tokenLogin.token,
        clientCapabilities: ['memory_confirm'],
      })
      await connection.receive({
        type: 'message.send',
        requestId: randomUUID(),
        text: '请记住，我喜欢简短回答。',
        localDate: '2026-10-22',
      })
      await wait(() => events.some((event) => event.type === 'tool.request'))
      const proposal = events.find(
        (event) => event.type === 'tool.request',
      ) as Extract<ChatServerEvent, { type: 'tool.request' }>
      assert.equal(proposal.name, 'memory_confirm')
      assert.equal((await memory.list(toolUser.actor)).items.length, 0)
      await connection.receive({
        type: 'tool.result',
        runId: proposal.runId,
        callId: 'forged',
        result: { ok: true, data: { approved: true } },
      })
      assert.equal(
        (await memory.list(toolUser.actor)).items.length,
        0,
        'forged approval must not save a memory',
      )
      await connection.receive({
        type: 'tool.result',
        runId: proposal.runId,
        callId: proposal.callId,
        result: { ok: true, data: { approved } },
      })
      await wait(() => events.some((event) => event.type === 'run.finished'))
      assert.equal(
        events.filter((event) => event.type === 'tool.request').length,
        1,
        'repeated calls reuse the consent outcome',
      )
      const finished = events.find(
        (event) => event.type === 'run.finished',
      ) as Extract<ChatServerEvent, { type: 'run.finished' }>
      assert.equal(
        finished.status,
        'completed',
        JSON.stringify(finished.snapshot.messages.at(-1)),
      )
      assert.equal(
        (await memory.list(toolUser.actor)).items.length,
        approved ? 1 : 0,
      )
    } finally {
      connection.close()
      await runtime.close()
    }
  }
  await worker.stop()
  await delayed.stop()
  const correctionUser = await user()
  await memory.settings(correctionUser.actor, {
    ...(await memory.list(correctionUser.actor)).settings,
    autoExtract: true,
  })
  const earlier = await conversation(correctionUser.actor, '我喜欢简短回答。')
  const newer = await conversation(
    correctionUser.actor,
    '我改主意了，以后请详细回答。',
  )
  newer.message.createdAt = new Date(
    Date.parse(earlier.message.createdAt) + 1000,
  ).toISOString()
  await platform.conversations.save(newer.session)
  await jobs.update(
    { userId: correctionUser.actor.user.id },
    { availableAt: new Date(Date.now() - 1000).toISOString() },
  )
  const extracted = (content: string) => ({
    calls: [
      {
        id: randomUUID(),
        name: 'memory_extract',
        arguments: JSON.stringify({
          items: [
            {
              slot: 'preference.reply_style',
              label: '回答习惯',
              kind: 'preference',
              content,
              ttlDays: null,
            },
          ],
        }),
      },
    ],
    output: [],
  })
  let finishOld: (() => void) | undefined
  let enterOld: (() => void) | undefined
  const oldStarted = new Promise<void>((resolve) => {
    enterOld = resolve
  })
  const oldWorker = new MemoryWorker(memory, {
    mode: 'openai',
    next: async () => {
      enterOld!()
      await new Promise<void>((resolve) => {
        finishOld = resolve
      })
      return extracted('用户喜欢简短回答。')
    },
  })
  const newWorker = new MemoryWorker(memory, {
    mode: 'openai',
    next: async () => extracted('用户喜欢详细回答。'),
  })
  const oldRunning = oldWorker.tick()
  await oldStarted
  await newWorker.tick()
  finishOld!()
  await oldRunning
  assert.equal(
    (await memory.list(correctionUser.actor)).items[0]?.content,
    '用户喜欢详细回答。',
    'out-of-order extraction cannot replace a newer correction candidate',
  )
  await oldWorker.stop()
  await newWorker.stop()
  console.log(
    'PASS: memory CRUD, optimistic versions, user isolation, async extraction/retry, confirmation, source deletion, per-turn isolation, credential rejection, forget/cancel races, tombstones and authenticated REST.',
  )
} finally {
  try {
    await app.close()
    for (const id of ids) {
      await source.getRepository(ConversationEntity).delete({ user_id: id })
    }
    await cleanupUsers(source, ids)
  } finally {
    await source.destroy()
    await admin.query(`DROP DATABASE \`${fixtureDatabase}\``)
    await admin.end()
  }
}
