import type { ChatServerEvent } from '@t-box/shared'
/** Durable answer versions and same-conversation regeneration; no paid model calls. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { definition } from '../src/agent/schema.js'
import { ApplicationChatService } from '../src/bootstrap/chat.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const platform = new PlatformService(source)
let userId: string | undefined
let runtime: ApplicationChatService | undefined
const wait = async (check: () => boolean) => {
  const end = Date.now() + 8000
  while (!check()) {
    if (Date.now() > end) {
      throw new Error('Missing retry event')
    }
    await new Promise((r) => setTimeout(r, 3))
  }
}
const finished = (events: ChatServerEvent[]) =>
  events.find((e) => e.type === 'run.finished') as Extract<
    ChatServerEvent,
    { type: 'run.finished' }
  >
try {
  const login = await platform.identity.register(
    {
      username: `retry_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
      nickname: '回答重试测试',
    },
    'retry-test',
  )
  userId = login.user.id
  let phase = 'initial'
  let round = 0
  let writes = 0
  let reads = 0
  const calls = (
    entries: { id: string, name: string, arguments: string }[],
  ) => ({
    calls: entries,
    output: entries.map((c) => ({
      type: 'function_call' as const,
      call_id: c.id,
      name: c.name,
      arguments: c.arguments,
    })),
  })
  runtime = new ApplicationChatService({
    platform,
    bills: createBillRepository(source),
    provider: {
      mode: 'openai',
      async next(input) {
        if (phase.startsWith('retry')) {
          assert.ok(JSON.stringify(input.history).includes('actual-write'))
          assert.ok(!JSON.stringify(input.history).includes('后续问题'))
          assert.ok(!JSON.stringify(input.history).includes('原回答第一版'))
        }
        if (round++ === 0 && phase === 'initial') {
          return calls([
            {
              id: randomUUID(),
              name: 'retry_fixture_save',
              arguments: '{"value":1}',
            },
          ])
        }
        if (round === 1 && phase === 'retry1') {
          return calls([
            {
              id: randomUUID(),
              name: 'retry_fixture_save',
              arguments: '{"value":1}',
            },
            {
              id: randomUUID(),
              name: 'retry_fixture_save',
              arguments: '{"value":2}',
            },
            { id: randomUUID(), name: 'retry_fixture_read', arguments: '{}' },
          ])
        }
        const text =
          phase === 'initial'
            ? '原回答第一版'
            : phase === 'future'
              ? '后续问题的原回答'
              : phase === 'retry1'
                ? '重试第二版'
                : '重试第三版'
        input.onDelta(text)
        return { calls: [], output: [{ role: 'assistant', content: text }] }
      },
    },
    modules: [
      {
        id: 'retry-fixture',
        skills: {},
        tools: {
          retry_fixture_save: {
            definition: definition('retry_fixture_save', '保存测试', {}),
            alwaysAvailable: true,
            successSummary: '执行完成',
            title: '保存',
            execution: 'server',
            effect: 'write',
            writeFingerprint: JSON.stringify,
            handler: async () => ({ id: 'actual-write', count: ++writes }),
          },
          retry_fixture_read: {
            definition: definition('retry_fixture_read', '查询测试', {}),
            alwaysAvailable: true,
            successSummary: '执行完成',
            title: '查询',
            execution: 'server',
            effect: 'read',
            handler: async () => ({ count: ++reads }),
          },
        },
      },
    ],
  })
  const events: ChatServerEvent[] = []
  const c = runtime.connect((e) => events.push(structuredClone(e)))
  await c.receive({ type: 'session.open', authToken: login.token })
  await c.receive({
    type: 'message.send',
    requestId: randomUUID(),
    text: '原问题',
    localDate: '2026-10-07',
  })
  await wait(() => !!finished(events))
  const first = finished(events)
  const conversationId = first.snapshot.conversationId!
  const answerId = first.snapshot.messages[1]!.id
  assert.equal(first.status, 'completed')
  assert.equal(writes, 1)
  phase = 'future'
  round = 0
  events.length = 0
  await c.receive({
    type: 'message.send',
    requestId: randomUUID(),
    text: '后续问题',
    localDate: '2026-10-07',
  })
  await wait(() => !!finished(events))
  const revision = finished(events).snapshot.conversationRevision
  phase = 'retry1'
  round = 0
  events.length = 0
  const command = {
    type: 'message.retry',
    requestId: randomUUID(),
    messageId: answerId,
    expectedRevision: revision,
  }
  await c.receive(command)
  await wait(() => !!finished(events))
  const retried = finished(events)
  assert.equal(
    retried.status,
    'completed',
    JSON.stringify(retried.snapshot.messages[1]!.error),
  )
  assert.equal(retried.snapshot.conversationId, conversationId)
  assert.equal(retried.snapshot.branch, undefined)
  assert.equal(retried.snapshot.messages.length, 4)
  assert.equal(retried.snapshot.messages[1]!.id, answerId)
  assert.equal(retried.snapshot.messages[1]!.content, '重试第二版')
  assert.equal(retried.snapshot.messages[1]!.answerRevision, 1)
  assert.equal(retried.snapshot.messages[3]!.content, '后续问题的原回答')
  assert.equal(writes, 1)
  assert.equal(reads, 1)
  const [old] = await source.query(
    'SELECT snapshot_json FROM conversation_answer_versions WHERE conversation_id=? AND message_id=?',
    [conversationId, answerId],
  )
  const original =
    typeof old.snapshot_json === 'string'
      ? JSON.parse(old.snapshot_json)
      : old.snapshot_json
  assert.equal(original.message.content, '原回答第一版')
  assert.equal(original.message.toolCalls[0].status, 'completed')
  assert.equal(original.calls[0][1].result.data.id, 'actual-write')
  const countBefore = round
  await c.receive(command)
  assert.equal(round, countBefore)
  phase = 'retry2'
  round = 0
  events.length = 0
  await c.receive({
    type: 'message.retry',
    requestId: randomUUID(),
    messageId: answerId,
    expectedRevision: retried.snapshot.conversationRevision,
  })
  await wait(() => !!finished(events))
  assert.equal(finished(events).snapshot.messages[1]!.content, '重试第三版')
  const versions = await source.query(
    'SELECT revision,snapshot_json FROM conversation_answer_versions WHERE conversation_id=? AND message_id=? ORDER BY revision',
    [conversationId, answerId],
  )
  assert.deepEqual(
    versions.map((v: { revision: number }) => Number(v.revision)),
    [0, 1],
  )
  assert.equal(
    (typeof versions[1].snapshot_json === 'string'
      ? JSON.parse(versions[1].snapshot_json)
      : versions[1].snapshot_json
    ).message.content,
    '重试第二版',
  )
  c.close()
  const actor = await platform.identity.authenticate(login.token)
  const restored = await platform.conversations.load(actor, conversationId)
  assert.equal(restored.messages[1]!.content, '重试第三版')
  assert.ok(JSON.stringify(restored.history).includes('后续问题'))
  assert.ok(!JSON.stringify(restored.history).includes('原回答第一版'))
  assert.equal(
    await platform.conversations.exists(actor, conversationId),
    true,
  )
  // A failed admission must not replace the displayed answer or create a phantom version.
  const failureEvents: ChatServerEvent[] = []
  const failureConnection = runtime.connect((e) =>
    failureEvents.push(structuredClone(e)),
  )
  await failureConnection.receive({
    type: 'session.open',
    authToken: login.token,
    conversationId,
  })
  const create = platform.tasks.create
  platform.tasks.create = async () => {
    throw new Error('fixture admission unavailable')
  }
  try {
    await failureConnection.receive({
      type: 'message.retry',
      requestId: randomUUID(),
      messageId: answerId,
    })
    await wait(() => !!finished(failureEvents))
    assert.equal(
      finished(failureEvents).snapshot.messages[1]!.content,
      '重试第三版',
    )
    assert.ok(
      failureEvents.some(
        (e) => e.type === 'error' && e.code === 'TASK_STORAGE_UNAVAILABLE',
      ),
    )
    const [{ count }] = await source.query(
      'SELECT COUNT(*) AS count FROM conversation_answer_versions WHERE conversation_id=?',
      [conversationId],
    )
    assert.equal(Number(count), 2)
  } finally {
    platform.tasks.create = create
    failureConnection.close()
  }
  console.info(
    'Answer retry integration passed: same conversation/question/answer IDs, isolated regeneration input, atomic durable original versions and receipts, repeat acknowledgement, old write reused, new write blocked, read allowed, later turns retained and history restored.',
  )
} finally {
  await runtime?.close()
  if (userId) {
    await cleanupUsers(source, [userId])
  }
  await source.destroy()
}
