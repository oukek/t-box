import type { ChatServerEvent } from '@t-box/shared'
import type { ChatProvider, ProviderTurn } from '../src/chat/provider.js'
/** Disposable MySQL user/task/archive/billing; fixture model only, no paid model calls. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { contextPolicy } from '../src/admin/context-policy.js'
import { defaultWorkflowPrompts } from '../src/agent-workflow/defaults.js'
import { definition } from '../src/agent/schema.js'
import { MeteredChatProvider } from '../src/billing/provider.js'
import { ApplicationChatService } from '../src/bootstrap/chat.js'
import { MemorySessionRepository } from '../src/chat/session.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const providerId = randomUUID()
const modelId = randomUUID()
let userId: string | undefined
let runtime: ApplicationChatService | undefined
const events: ChatServerEvent[] = []
const wait = async (check: () => boolean) => {
  const until = Date.now() + 12000
  while (!check()) {
    if (Date.now() > until) {
      throw new Error('Missing context integration event')
    }
    await new Promise((r) => setTimeout(r, 5))
  }
}
const call = (name: string, args: unknown): ProviderTurn => {
  const id = randomUUID()
  const arguments_ = JSON.stringify(args)
  return {
    calls: [{ id, name, arguments: arguments_ }],
    output: [
      { type: 'function_call', call_id: id, name, arguments: arguments_ },
    ],
  }
}
try {
  const login = await platform.identity.register(
    {
      username: `context_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
      nickname: '上下文测试',
    },
    'context-test',
  )
  userId = login.user.id
  await source.query(
    'INSERT INTO ai_providers(id,name,base_url,key_cipher,enabled) VALUES(?,?,?,?,1)',
    [providerId, 'context-fixture', 'http://localhost:1/v1', 'fixture'],
  )
  await source.query(
    'INSERT INTO ai_models(id,provider_id,model_id,name,enabled) VALUES(?,?,?,?,1)',
    [modelId, providerId, 'fixture', 'context-fixture'],
  )
  let executed = 0
  let summaries = 0
  let reviewSeen = false
  let rounds = 0
  let expectPrevious = false
  let failAnswer = true
  let seenPrevious = false
  const provider: ChatProvider = {
    mode: 'openai',
    configurationKey: 'context-fixture',
    maxOutputTokens: 32768,
    contextPolicy: contextPolicy({
      ...contextPolicy(null),
      maxInputTokens: 49152,
      keepRecentTurns: 4,
    }),
    async summarize(input) {
      assert.equal(input.toolChoice, 'none')
      assert.equal(input.tools.length, 0)
      const timelineEvents = events.filter((e) => e.type === 'timeline.update')
      assert.ok(
        timelineEvents.some(
          (e) =>
            e.type === 'timeline.update' &&
            e.item.kind === 'analysis' &&
            e.item.label === '整理上下文' &&
            e.item.status === 'streaming',
        ),
      )
      if (
        expectPrevious &&
        JSON.stringify(input.history).includes('五次查询完成')
      ) {
        seenPrevious = true
      }
      summaries++
      await input.onUsage?.({
        responseId: `summary-${summaries}`,
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 10,
      })
      return seenPrevious
        ? '上一轮已完成五次查询。保留实际查询记录，不重复执行。'
        : '用户要求查询五次，部分回执已保存；具体成功以独立执行记录为准，不重复执行已完成的查询。'
    },
    async next(input) {
      if (input.execution?.purpose === 'answer' && failAnswer) {
        failAnswer = false
        throw Object.assign(new Error('fixture'), { status: 429 })
      }
      await input.onUsage?.({
        responseId: randomUUID(),
        inputTokens: 100,
        outputTokens: 20,
      })
      if (input.tools[0]?.name === 'workflow_plan') {
        if (expectPrevious) {
          assert.ok(
            seenPrevious ||
            JSON.stringify(input.history).includes('五次查询完成'),
          )
        }
        return call('workflow_plan', {
          route: expectPrevious ? 'answer' : 'execute',
          summary: '按请求查询五次，随后核对结果。',
          steps: expectPrevious ? [] : ['查询五次'],
          requiredTools: expectPrevious ? [] : ['context_read'],
        })
      }
      if (input.execution?.purpose === 'review') {
        reviewSeen = true
        // The first call has left raw model history, but review still receives its authoritative receipt.
        assert.match(input.instructions, /actual-0/)
        assert.match(input.instructions, /actual-4/)
        return call('workflow_review', {
          action: 'complete',
          summary: '五次查询真实回执已核对。',
          next: '',
        })
      }
      if (input.execution?.purpose === 'answer') {
        input.onDelta('五次查询完成。')
        return {
          calls: [],
          output: [{ role: 'assistant', content: '五次查询完成。' }],
        }
      }
      if (rounds++ < 5) {
        return call('context_read', { index: rounds - 1 })
      }
      input.onDelta('查询完毕，准备核对。')
      return {
        calls: [],
        output: [{ role: 'assistant', content: '查询完毕，准备核对。' }],
      }
    },
  }
  runtime = new ApplicationChatService({
    platform,
    bills: createBillRepository(source),
    maxToolRounds: 12,
    workflow: {
      snapshot: async () => ({
        revision: 1,
        prompts: defaultWorkflowPrompts,
        updatedAt: new Date().toISOString(),
      }),
    },
    provider: new MeteredChatProvider(provider, platform.billing, modelId, {
      inputPrice: '0',
      outputPrice: '0',
      imagePrice: '0',
    }),
    modules: [
      {
        id: 'context-fixture',
        skills: {},
        tools: {
          context_read: {
            definition: definition('context_read', '查询测试数据', {
              index: { type: 'integer' },
            }),
            alwaysAvailable: true,
            title: '查询测试',
            execution: 'server',
            effect: 'read',
            successSummary: '查询完成',
            handler: async (args) => {
              executed++
              return {
                id: `actual-${(args as { index: number }).index}`,
                payload: 'x'.repeat(12000),
              }
            },
          },
        },
      },
    ],
  })
  const c = runtime.connect((e) => events.push(structuredClone(e)))
  await c.receive({ type: 'session.open', authToken: login.token })
  await c.receive({
    type: 'message.send',
    requestId: randomUUID(),
    text: '查询五次后总结',
    localDate: '2026-10-07',
  })
  await wait(() => events.some((e) => e.type === 'run.finished'))
  let final = events.find((e) => e.type === 'run.finished') as Extract<
    ChatServerEvent,
    { type: 'run.finished' }
  >
  assert.equal(final.status, 'failed')
  assert.equal(final.snapshot.task?.status, 'paused')
  assert.equal(executed, 5)
  assert.ok(reviewSeen)
  assert.ok(summaries >= 1)
  const actor = await platform.identity.authenticate(login.token)
  const stored = await platform.tasks.get(actor, final.snapshot.task!.id)
  assert.ok((stored.checkpoint as any).frames[0].contextState.compactions >= 1)
  const beforeSummaries = summaries
  events.length = 0
  await c.receive({ type: 'task.resume', taskId: final.snapshot.task!.id })
  await wait(() => events.some((e) => e.type === 'run.finished'))
  final = events.find((e) => e.type === 'run.finished') as typeof final
  assert.equal(final.status, 'completed')
  assert.equal(executed, 5)
  assert.equal(
    summaries,
    beforeSummaries,
    'resume should not compact the same context again',
  )
  const archived = await platform.conversations.load(
    actor,
    final.snapshot.conversationId!,
  )
  assert.ok(archived.contextState?.compactions)
  assert.equal(archived.messages.at(-1)!.toolCalls.length, 5)
  assert.equal(
    archived.calls.filter(([id]) =>
      archived.messages.at(-1)!.toolCalls.some((t) => t.id === id),
    ).length,
    5,
  )
  assert.ok(JSON.stringify(archived.messages).includes('整理上下文'))
  const records = (await platform.billing.records(userId)).filter(
    (r) => r.purpose === 'compaction',
  )
  assert.equal(records.length, summaries)
  assert.equal(new Set(records.map((r) => r.id)).size, summaries)
  assert.ok(
    records.every((r) => r.inputTokens === 100 && r.outputTokens === 20),
  )
  c.close()
  await runtime.close()
  // A fresh server session restores compacted history/state, then includes the preceding answer on the next turn.
  const sessions = new MemorySessionRepository()
  const restored = sessions.create()
  await platform.conversations.restore(
    actor,
    final.snapshot.conversationId!,
    restored,
  )
  assert.deepEqual(restored.contextState, archived.contextState)
  expectPrevious = true
  events.length = 0
  const c2 = runtime.connect((e) => events.push(structuredClone(e)))
  await c2.receive({
    type: 'session.open',
    authToken: login.token,
    conversationId: final.snapshot.conversationId!,
  })
  await c2.receive({
    type: 'message.send',
    requestId: randomUUID(),
    text: '继续说一下',
    localDate: '2026-10-07',
  })
  await wait(() => events.some((e) => e.type === 'run.finished'))
  final = events.find((e) => e.type === 'run.finished') as typeof final
  assert.equal(
    final.status,
    'completed',
    JSON.stringify(final.snapshot.messages.at(-1)?.error),
  )
  assert.equal(executed, 5)
  c2.close()
  console.info(
    'Context integration passed: mid-run compression timeline, independent receipt ownership, unique billed summary usage, pause/resume, durable memory and current conversation history.',
  )
} finally {
  await runtime?.close()
  if (userId) {
    await cleanupUsers(source, [userId])
  }
  await source.query('DELETE FROM ai_models WHERE id=?', [modelId])
  await source.query('DELETE FROM ai_providers WHERE id=?', [providerId])
  await source.destroy()
}
