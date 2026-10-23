import type { ChatServerEvent } from '@t-box/shared'
import type { ApplicationModule } from '../src/agent/contracts.js'
import type { ChatProvider, ProviderTurn } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createShellModule } from '../src/agent/builtins.js'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { definition } from '../src/agent/schema.js'
import { ChatService } from '../src/chat/engine.js'

const call = (id: string, name: string, args: unknown): ProviderTurn => ({
  calls: [{ id, name, arguments: JSON.stringify(args) }],
  output: [
    {
      type: 'function_call',
      call_id: id,
      name,
      arguments: JSON.stringify(args),
    },
  ],
})
const wait = async (check: () => boolean) => {
  const end = Date.now() + 2000
  while (!check()) {
    if (Date.now() > end) {
      throw new Error('Missing event')
    }
    await new Promise((r) => setTimeout(r, 2))
  }
}
function modules() {
  const count = { notes: 0, finance: 0 }
  const module = (id: 'notes' | 'finance'): ApplicationModule => ({
    id,
    manifest: {
      id,
      name: id,
      description: id,
      icon: 'file',
      color: 'blue',
      version: '1',
      skillIds: [id],
    },
    agents: [
      {
        id,
        title: `${id}专业助手`,
        description: id,
        version: '1',
        skillIds: [id],
        instructions: `只负责 ${id}`,
      },
    ],
    skills: {
      [id]: {
        title: id,
        description: id,
        version: '1',
        tools: [`${id}_save`],
        instructions: id,
      },
    },
    tools: {
      [`${id}_save`]: {
        definition: definition(`${id}_save`, id, { text: { type: 'string' } }),
        title: id,
        execution: 'server',
        effect: 'write',
        writeFingerprint: JSON.stringify,
        successSummary: '已保存',
        handler: async () => ({ count: ++count[id] }),
      },
    },
  })
  return { modules: [module('notes'), module('finance')], count }
}
test('manager delegates into isolated context, specialist cannot activate foreign skills or execute foreign tools, and manager receives its summary', async (t) => {
  const fixture = modules()
  const registry = new CapabilityRegistry([
    ...fixture.modules,
    createShellModule(fixture.modules),
  ])
  let rootRounds = 0
  let childRounds = 0
  const provider: ChatProvider = {
    mode: 'openai',
    async next(input) {
      if (input.instructions.includes('你是 T方舟 的notes专业助手')) {
        assert.ok(input.tools.some((t) => t.name === 'notes_save'))
        assert.ok(
          !input.tools.some(
            (t) => t.name === 'finance_save' || t.name === 'agent_delegate',
          ),
        )
        assert.ok(
          !JSON.stringify(input.history).includes('与任务无关的旧会话秘密'),
        )
        const steps = [
          call('activate-foreign', 'skill_activate', { skillId: 'finance' }),
          call('foreign', 'finance_save', { text: 'unauthorized' }),
          call('own', 'notes_save', { text: '笔记' }),
          call('own-repeat', 'notes_save', { text: '笔记' }),
        ]
        const next = steps[childRounds++]
        if (next) {
          return next
        }
        const errors = input.history
          .filter((x) => x.type === 'function_call_output')
          .map((x) => JSON.parse((x as { output: string }).output))
        assert.equal(errors[0].ok, false)
        assert.equal(errors[1].error.code, 'TOOL_NOT_ALLOWED')
        input.onDelta('笔记已保存')
        return {
          calls: [],
          output: [{ role: 'assistant', content: '笔记已保存' }],
        }
      }
      if (rootRounds++ === 0) {
        return call('delegate', 'agent_delegate', {
          agentId: 'notes',
          task: '保存用户指定笔记',
        })
      }
      assert.ok(JSON.stringify(input.history).includes('笔记已保存'))
      assert.ok(!JSON.stringify(input.history).includes('activate-foreign'))
      input.onDelta('已完成笔记保存。')
      return {
        calls: [],
        output: [{ role: 'assistant', content: '已完成笔记保存。' }],
      }
    },
  }
  const chat = new ChatService({ registry, provider })
  const events: ChatServerEvent[] = []
  const connection = chat.connect((e) => events.push(e))
  t.after(async () => {
    connection.close()
    await chat.close()
  })
  await connection.receive({ type: 'session.open' })
  ;[...chat.sessions.all()][0]!.history.push({
    role: 'user',
    content: '与任务无关的旧会话秘密',
  })
  await connection.receive({
    type: 'message.send',
    requestId: 'delegate-test',
    text: '把笔记保存到 notes',
    localDate: '2026-10-06',
  })
  await wait(() => events.some((e) => e.type === 'run.finished'))
  assert.deepEqual(fixture.count, { notes: 1, finance: 0 })
  const end = events.find((e) => e.type === 'run.finished') as Extract<
    ChatServerEvent,
    { type: 'run.finished' }
  >
  assert.equal(end.status, 'completed')
  assert.equal(end.snapshot.messages.at(-1)!.content, '已完成笔记保存。')
  assert.deepEqual(
    events
      .filter((e) => e.type === 'agent.changed')
      .map((e) => (e as { agentId: string }).agentId),
    ['assistant', 'notes', 'assistant'],
  )
})
test('explicit application selection routes directly to its specialist; unknown agents and delegation loops are rejected', async (t) => {
  const fixture = modules()
  const registry = new CapabilityRegistry([
    ...fixture.modules,
    createShellModule(fixture.modules),
  ])
  let rounds = 0
  const chat = new ChatService({
    registry,
    provider: {
      mode: 'openai',
      async next(input) {
        assert.match(input.instructions, /notes专业助手/)
        if (rounds++ === 0) {
          return call('nested', 'agent_delegate', {
            agentId: 'finance',
            task: 'escape',
          })
        }
        assert.match(JSON.stringify(input.history), /TOOL_NOT_ALLOWED/)
        return { calls: [], output: [] }
      },
    },
  })
  const events: ChatServerEvent[] = []
  const connection = chat.connect((e) => events.push(e))
  t.after(async () => {
    connection.close()
    await chat.close()
  })
  await connection.receive({ type: 'session.open' })
  await connection.receive({
    type: 'message.send',
    requestId: 'selected',
    text: '保存笔记',
    localDate: '2026-10-06',
    applicationIds: ['notes'],
  })
  await wait(() => events.some((e) => e.type === 'run.finished'))
  assert.deepEqual(fixture.count, { notes: 0, finance: 0 })
  assert.deepEqual(
    events
      .filter((e) => e.type === 'agent.changed')
      .map((e) => (e as { agentId: string }).agentId),
    ['notes'],
  )
  assert.throws(
    () =>
      new CapabilityRegistry([
        {
          ...fixture.modules[0]!,
          agents: [
            {
              id: 'escape',
              title: '',
              description: '',
              version: '1',
              skillIds: ['finance'],
              instructions: '',
            },
          ],
        },
      ]),
    /must belong/,
  )
})

test('reusing a durable skill activation restores its local tool scope without redispatching the completed tool', async () => {
  const { executeTool } = await import('../src/agent/executor.js')
  const { MemorySessionRepository } = await import('../src/chat/session.js')
  const fixture = modules()
  const registry = new CapabilityRegistry([
    ...fixture.modules,
    createShellModule(fixture.modules),
  ])
  const session = new MemorySessionRepository().create()
  const skills = new Set<string>()
  const assistant = {
    id: 'assistant',
    role: 'assistant' as const,
    content: '',
    createdAt: new Date().toISOString(),
    toolCalls: [],
  }
  session.messages.push(assistant)
  let dispatches = 0
  const result = await executeTool(
    {
      registry,
      session,
      skills,
      bindings: [],
      requestId: 'restore-skill',
      signal: new AbortController().signal,
      interact: async () => ({
        ok: false,
        error: { code: 'NO_UI', message: 'No UI' },
      }),
      use: async (_key, factory) => factory(),
      journal: {
        lookup: async () => ({ ok: true, data: { skillId: 'notes' } }),
        guard: async () => {},
        dispatch: async () => {
          dispatches++
        },
        complete: async () => {},
      },
    },
    {
      view: {
        id: 'restore-skill',
        requestId: 'restore-skill',
        assistantMessageId: 'assistant',
        status: 'running',
      },
      abort: new AbortController(),
    },
    assistant,
    {
      id: 'completed-activation',
      name: 'skill_activate',
      arguments: '{"skillId":"notes"}',
    },
    new Map(),
    { save: async () => {} },
  )
  assert.equal(result.ok, true)
  assert.equal(dispatches, 0)
  assert.ok(
    registry.allowedTools(skills).some((tool) => tool.name === 'notes_save'),
  )
})

test('a failed external tool publishes its actual error before the journal requires review', async () => {
  const { executeTool } = await import('../src/agent/executor.js')
  const { MemorySessionRepository } = await import('../src/chat/session.js')
  const { ApiError } = await import('@t-box/server-foundation/errors')
  const fixture = modules()
  const module = fixture.modules[0]!
  module.tools.notes_save!.effect = 'external'
  module.tools.notes_save!.handler = async () => {
    throw new ApiError(
      502,
      'IMAGE_DOWNLOAD_FAILED',
      '服务商图片下载失败（HTTP 403）',
    )
  }
  const registry = new CapabilityRegistry(fixture.modules)
  const session = new MemorySessionRepository().create()
  const events: ChatServerEvent[] = []
  session.send = (event) => events.push(event)
  const assistant = {
    id: 'assistant',
    role: 'assistant' as const,
    content: '',
    createdAt: new Date().toISOString(),
    toolCalls: [],
  }
  session.messages.push(assistant)
  let dispatches = 0
  await assert.rejects(
    executeTool(
      {
        registry,
        session,
        skills: new Set(['notes']),
        bindings: [],
        requestId: 'failed-image',
        signal: new AbortController().signal,
        interact: async () => ({
          ok: false,
          error: { code: 'NO_UI', message: 'No UI' },
        }),
        use: async (_key, factory) => factory(),
        journal: {
          lookup: async () => undefined,
          guard: async () => {},
          dispatch: async () => {
            dispatches++
          },
          complete: async (_id, result) => {
            assert.equal(result.ok, false)
            throw new ApiError(409, 'TOOL_OUTCOME_UNCERTAIN', '请核对操作')
          },
        },
      },
      {
        view: {
          id: 'failed-image',
          requestId: 'failed-image',
          assistantMessageId: assistant.id,
          status: 'running',
        },
        abort: new AbortController(),
      },
      assistant,
      { id: 'image-call', name: 'notes_save', arguments: '{"text":"image"}' },
      new Map(),
      { save: async () => {} },
    ),
    { code: 'TOOL_OUTCOME_UNCERTAIN' },
  )
  assert.equal(dispatches, 1)
  const update = events.filter((e) => e.type === 'tool.update').at(-1)
  assert.equal(update?.type, 'tool.update')
  if (update?.type !== 'tool.update') {
    throw new Error('Missing tool update')
  }
  assert.equal(update.tool.status, 'failed')
  assert.equal(update.tool.summary, '服务商图片下载失败（HTTP 403）')
  assert.equal(session.calls.has('image-call'), false)
})
