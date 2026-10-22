import type { Actor, ApplicationModule } from '../src/agent/contracts.js'
import type { ChatProvider } from '../src/chat/provider.js'
import type { MemoryPort } from '../src/memory/contracts.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createShellModule } from '../src/agent/builtins.js'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { runConversation } from '../src/agent/runner.js'
import { MemorySessionRepository } from '../src/chat/session.js'

const actor: Actor = {
  user: {
    id: 'user',
    username: 'fixture',
    nickname: 'fixture',
    createdAt: '2026-10-22T00:00:00Z',
  },
  sessionHash: 'fixture',
}
test('recall is ephemeral, adds no model phase, and an opted-out turn exposes no memory tools', async () => {
  let recalls = 0
  let calls = 0
  const memory: MemoryPort = {
    recall: async (who) => {
      assert.equal(who.user.id, actor.user.id)
      recalls++
      return '用户偏好 MEMORY_FIXTURE 简洁回答'
    },
    search: async () => [],
    remember: async () => {
      throw new Error('unexpected write')
    },
    forget: async () => {
      throw new Error('unexpected delete')
    },
  }
  const sessions = new MemorySessionRepository()
  const specialist: ApplicationModule = {
    id: 'special',
    tools: {},
    skills: {},
    agents: [
      {
        id: 'specialist',
        title: '专业助手',
        description: '隔离测试',
        version: '1',
        skillIds: [],
        instructions: '只处理当前明确子任务',
      },
    ],
  }
  const registry = new CapabilityRegistry([
    specialist,
    createShellModule([specialist], true),
  ])
  try {
    for (const scenario of [
      { enabled: true, applications: [] },
      { enabled: false, applications: [] },
      { enabled: true, applications: ['special'] },
    ]) {
      const { enabled, applications } = scenario
      const canRecall = enabled && !applications.length
      const session = sessions.create()
      session.userId = actor.user.id
      const provider: ChatProvider = {
        mode: 'openai',
        async next(input) {
          calls++
          assert.equal(input.instructions.includes('MEMORY_FIXTURE'), canRecall)
          assert.equal(
            input.tools.some((tool) => tool.name === 'memory_remember'),
            canRecall,
          )
          input.onDelta('2')
          return { calls: [], output: [{ role: 'assistant', content: '2' }] }
        },
      }
      await runConversation(
        {
          provider,
          registry,
          capabilityLoading: 'deferred',
          host: {
            memory,
            identity: {
              authenticate: async () => actor,
              authenticateHash: async () => actor,
            },
          },
        },
        sessions,
        {
          session,
          requestId: `request-${enabled}`,
          text: '1+1',
          localDate: '2026-10-22',
          principal: actor,
          bindings: [],
          attachments: [],
          applicationIds: applications,
          provider,
          memoryEnabled: enabled,
        },
      )
      assert.equal(session.messages.at(-1)?.outcome, 'completed')
      assert.equal(session.messages[0]?.memoryEnabled, enabled)
      assert.ok(
        !JSON.stringify(session.history).includes('MEMORY_FIXTURE'),
        'long-term bodies must not become durable provider history',
      )
    }
    assert.equal(calls, 3, 'one provider request per simple question')
    assert.equal(recalls, 1)
  } finally {
    sessions.clear()
  }
})
