/** Disposable MySQL, fake model and a generic application contract; no paid calls. */
import type { ChatServerEvent } from '@t-box/shared'
import type { RunCheckpoint } from '../src/agent/checkpoint.js'
import type { ApplicationModule } from '../src/agent/contracts.js'
import type { ChatProvider, ProviderTurn } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { defaultWorkflowPrompts } from '../src/agent-workflow/defaults.js'
import { createShellModule } from '../src/agent/builtins.js'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { definition } from '../src/agent/schema.js'
import { ChatService } from '../src/chat/engine.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

if (!/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('Requires a disposable t_box_ci / t_box_test_* database')
}
const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const users: string[] = []
const services: ChatService[] = []
let executed = 0
let failOnce = true
let boundedResultSeen = false
const module: ApplicationModule = {
  id: 'discovery_fixture',
  skills: { fixture_skill: { title: '查询测试', description: '查询测试记录', version: '1', instructions: '按授权查询，只报告真实回执。', tools: ['fixture_read'] } },
  tools: { fixture_read: { definition: definition('fixture_read', '查询测试记录', {}), title: '查询测试记录', execution: 'server', effect: 'read', successSummary: '已查询', handler: async () => ({ id: ++executed, payload: '资料'.repeat(10000) }) } },
}
const registry = new CapabilityRegistry([module, createShellModule([module])])
platform.conversations.setAccess(registry.access)
const call = (id: string, name: string, args: unknown): ProviderTurn => ({ calls: [{ id, name, arguments: JSON.stringify(args) }], output: [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }] })
const provider: ChatProvider = {
  mode: 'openai',
  configurationKey: 'discovery-fixture-stable',
  async next(input) {
    const done = new Set(input.history.flatMap((item) => item.type === 'function_call_output' ? [item.call_id] : []))
    if (!done.has('discover')) {
      assert.ok(input.tools.some((tool) => tool.name === 'capability_search'))
      assert.ok(!input.tools.some((tool) => tool.name === 'fixture_read'))
      return call('discover', 'capability_search', { query: 'fixture_read', appId: null, offset: null })
    }
    if (!done.has('plan')) {
      return call('plan', 'workflow_plan', { route: 'execute', summary: '查询记录', steps: ['查询'], requiredTools: ['fixture_read'], verification: 'model' })
    }
    if (!done.has('execute')) {
      assert.ok(input.tools.some((tool) => tool.name === 'fixture_read'))
      return call('execute', 'fixture_read', {})
    }
    const receipt = input.history.find((item) => item.type === 'function_call_output' && item.call_id === 'execute') as { output: string }
    boundedResultSeen = JSON.parse(receipt.output).data.truncated === true
    assert.ok(Buffer.byteLength(receipt.output) < 12288)
    if (failOnce) {
      failOnce = false
      throw new Error('fixture model pause after committed result')
    }
    if (input.execution?.purpose === 'review') {
      return call('review', 'workflow_review', { action: 'complete', summary: '核对真实回执', next: '' })
    }
    input.onDelta('已读取记录，完整结果保留。')
    return { calls: [], output: [{ role: 'assistant', content: '已读取记录，完整结果保留。' }] }
  },
}
const wait = async (events: ChatServerEvent[]) => {
  const deadline = Date.now() + 10000
  while (!events.some((event) => event.type === 'run.finished')) {
    assert.ok(Date.now() < deadline, 'Missing durable discovery completion')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
try {
  const login = await platform.identity.register({ username: `discovery_${randomUUID().replaceAll('-', '')}`, password: 'test123' }, 'discovery-fixture')
  users.push(login.user.id)
  const actor = await platform.identity.authenticate(login.token)
  const start = async (conversationId?: string) => {
    const runtime = new ChatService({
      registry,
      provider,
      capabilityLoading: 'deferred',
      workflow: { snapshot: async () => ({ revision: 1, updatedAt: 'now', prompts: defaultWorkflowPrompts }) },
      configuration: { snapshot: async () => ({ revision: 1, values: { 'ai.tools.maxLoaded': 2 } }) },
      host: { identity: platform.identity, tasks: platform.tasks, conversations: platform.conversations },
    })
    services.push(runtime)
    const events: ChatServerEvent[] = []
    const connection = runtime.connect((event) => events.push(structuredClone(event)))
    await connection.receive({ type: 'session.open', authToken: login.token, ...(conversationId ? { conversationId } : {}) })
    assert.ok(events.some((event) => event.type === 'session.ready'))
    return { runtime, events, connection }
  }
  const first = await start()
  await first.connection.receive({ type: 'message.send', requestId: randomUUID(), text: '查询测试记录', localDate: '2026-10-17' })
  await wait(first.events)
  const paused = first.events.findLast((event) => event.type === 'run.finished') as Extract<ChatServerEvent, { type: 'run.finished' }>
  assert.equal(paused.snapshot.task?.status, 'paused')
  assert.equal(executed, 1)
  const task = await platform.tasks.get(actor, paused.snapshot.task!.id)
  const checkpoint = task.checkpoint as RunCheckpoint
  assert.equal(checkpoint.capabilityLoading, 'deferred')
  assert.deepEqual(checkpoint.frames[0]!.capabilities?.loadedTools, ['fixture_read'])
  assert.deepEqual(checkpoint.frames[0]!.skills, ['fixture_skill'])
  const receipt = task.tools.find((tool) => tool.name === 'fixture_read')!.result
  assert.equal((receipt as { data: { payload: string } }).data.payload.length, 20000, 'Journal keeps complete receipt')
  first.connection.close()
  await first.runtime.close()
  const second = await start(paused.snapshot.conversationId)
  await second.connection.receive({ type: 'task.resume', taskId: task.summary.id })
  await wait(second.events)
  const finished = second.events.findLast((event) => event.type === 'run.finished') as typeof paused
  assert.equal(finished.status, 'completed')
  assert.equal(executed, 1, 'Restart must not repeat the application handler')
  assert.equal(boundedResultSeen, true)
  assert.equal(finished.snapshot.messages.at(-1)?.content, '已读取记录，完整结果保留。')
  console.log('Deferred capability integration passed: database checkpoint, bounded model receipts, complete durable evidence, fresh-process restore and no tool replay.')
} finally {
  for (const service of services) {
    await service.close()
  }
  await cleanupUsers(source, users)
  await source.destroy()
}
