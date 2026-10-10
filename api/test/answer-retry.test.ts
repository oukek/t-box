import type { ChatMessage, ChatServerEvent } from '@t-box/shared'
import type { AgentRuntimeOptions } from '../src/agent/contracts.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createShellModule } from '../src/agent/builtins.js'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { definition } from '../src/agent/schema.js'
import { prepareAnswerRetry, retryPair } from '../src/chat/answer-retry.js'
import { ChatService } from '../src/chat/engine.js'
import { forkMessageConversation } from '../src/chat/message-commands.js'
import { MemorySessionRepository } from '../src/chat/session.js'

function fixture() {
  const sessions = new MemorySessionRepository()
  const session = sessions.create()
  session.conversationId = 'same-conversation'
  session.messages = Array.from({ length: 3 }, (_, i) => [
    {
      id: `u${i}`,
      role: 'user',
      content: `question ${i}`,
      createdAt: 'now',
      toolCalls: [],
    },
    {
      id: `a${i}`,
      role: 'assistant',
      content: `original answer ${i}`,
      createdAt: 'now',
      toolCalls: [],
      outcome: 'completed',
    },
  ]).flat() as ChatMessage[]
  session.messages[3]!.toolCalls = [
    {
      id: 'old-call',
      name: 'fixture_write',
      title: '写入',
      execution: 'server',
      status: 'completed',
    },
  ]
  session.calls.set('old-call', {
    fingerprint: 'fixture_write:{"value":1}',
    result: { ok: true, data: { id: 'existing-result' } },
  })
  let writes = 0
  let reads = 0
  let external = 0
  const registry = new CapabilityRegistry([
    createShellModule([]),
    {
      id: 'fixture',
      skills: {},
      tools: {
        fixture_write: {
          definition: definition('fixture_write', '写入', {}),
          alwaysAvailable: true,
          successSummary: '执行完成',
          title: '写入',
          execution: 'server',
          effect: 'write',
          writeFingerprint: JSON.stringify,
          handler: async () => {
            writes++
            return {}
          },
        },
        fixture_read: {
          definition: definition('fixture_read', '查询', {}),
          alwaysAvailable: true,
          successSummary: '执行完成',
          title: '查询',
          execution: 'server',
          effect: 'read',
          handler: async () => {
            reads++
            return {}
          },
        },
        fixture_external: {
          definition: definition('fixture_external', '外部', {}),
          alwaysAvailable: true,
          successSummary: '执行完成',
          title: '外部',
          execution: 'server',
          effect: 'external',
          writeFingerprint: JSON.stringify,
          handler: async () => {
            external++
            return {}
          },
        },
      },
    },
  ])
  const options: AgentRuntimeOptions = {
    sessions,
    registry,
    provider: {
      mode: 'openai',
      async next() {
        return { calls: [], output: [] }
      },
    },
  }
  return {
    sessions,
    session,
    options,
    counts: () => ({ writes, reads, external }),
  }
}
test('retry isolates the target question, keeps original snapshot and normalized receipts, and rejects user targets', () => {
  const { session, options } = fixture()
  const before = structuredClone(session.messages)
  const prepared = prepareAnswerRetry(options, session, 'a1', 'retry-1')
  assert.equal(prepared.assistant.id, 'a1')
  assert.equal(prepared.assistant.answerRevision, 1)
  assert.equal(session.messages.length, 6)
  assert.deepEqual(session.messages.slice(4), before.slice(4))
  assert.ok(!JSON.stringify(session.history).includes('question 2'))
  assert.ok(!JSON.stringify(session.history).includes('original answer 1'))
  assert.ok(JSON.stringify(session.history).includes('existing-result'))
  assert.equal(
    session.pendingAnswerVersion!.message.content,
    'original answer 1',
  )
  prepared.assistant.content = 'new text'
  assert.equal(
    session.pendingAnswerVersion!.message.content,
    'original answer 1',
  )
  assert.deepEqual(prepared.writes[0], [
    'fixture_write:{"value":1}',
    { ok: true, data: { id: 'existing-result' } },
  ])
  assert.throws(() => retryPair(session, 'u1'), {
    code: 'MESSAGE_ROLE_INVALID',
  })
})
test('later branches retain retry receipts; editing the original question keeps side-effect continuity', () => {
  const { session, options, sessions } = fixture()
  prepareAnswerRetry(options, session, 'a1', 'retry-original')
  session.messages[3]!.content = 'regenerated without new tool calls'
  const later = forkMessageConversation(options, session, sessions, 'u2')
  assert.ok(later.calls.has('old-call'))
  assert.ok(later.answerRetryEvidence?.a1)
  assert.ok(JSON.stringify(later.history).includes('existing-result'))
  assert.ok(
    prepareAnswerRetry(options, later, 'a1', 'retry-in-branch').writes.some(
      ([key]) => key === 'fixture_write:{"value":1}',
    ),
  )
  const original = forkMessageConversation(options, session, sessions, 'u1')
  assert.ok(original.branch?.executionContext?.includes('existing-result'))
})
test('socket retry replaces only the answer in the same conversation, reuses old writes and blocks new side effects', async (t) => {
  const { session, options, counts } = fixture()
  let rounds = 0
  options.provider = {
    mode: 'openai',
    async next(input) {
      assert.ok(!JSON.stringify(input.history).includes('question 2'))
      if (rounds++ === 0) {
        const calls = [
          { id: 'replay', name: 'fixture_write', arguments: '{"value":1}' },
          { id: 'blocked', name: 'fixture_write', arguments: '{"value":2}' },
          { id: 'external', name: 'fixture_external', arguments: '{}' },
          { id: 'read', name: 'fixture_read', arguments: '{}' },
        ]
        return {
          calls,
          output: calls.map((c) => ({
            type: 'function_call' as const,
            call_id: c.id,
            name: c.name,
            arguments: c.arguments,
          })),
        }
      }
      input.onDelta('regenerated answer')
      return {
        calls: [],
        output: [{ role: 'assistant', content: 'regenerated answer' }],
      }
    },
  }
  const events: ChatServerEvent[] = []
  const service = new ChatService(options)
  const c = service.connect((e) => events.push(structuredClone(e)))
  t.after(async () => {
    c.close()
    await service.close()
  })
  await c.receive({
    type: 'session.open',
    sessionId: session.id,
    token: session.token,
  })
  const command = {
    type: 'message.retry',
    requestId: 'retry-1',
    messageId: 'a1',
  }
  await c.receive(command)
  const end = Date.now() + 3000
  while (!events.some((e) => e.type === 'run.finished')) {
    if (Date.now() > end) {
      throw new Error('retry timed out')
    }
    await new Promise((r) => setTimeout(r, 2))
  }
  assert.equal(session.conversationId, 'same-conversation')
  assert.equal(session.branch, undefined)
  assert.equal(session.messages.length, 6)
  assert.equal(session.messages[3]!.content, 'regenerated answer')
  assert.equal(session.messages[5]!.content, 'original answer 2')
  assert.ok(JSON.stringify(session.history).includes('question 2'))
  assert.deepEqual(counts(), { writes: 0, reads: 1, external: 0 })
  assert.deepEqual(session.calls.get('replay')!.result, {
    ok: true,
    data: { id: 'existing-result' },
  })
  assert.equal(
    (session.calls.get('blocked')!.result as { error: { code: string } }).error
      .code,
    'RETRY_SIDE_EFFECT_BLOCKED',
  )
  await c.receive(command)
  assert.equal(rounds, 2)
  assert.equal(events.filter((e) => e.type === 'run.started').length, 1)
})
