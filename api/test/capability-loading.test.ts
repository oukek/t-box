import type { ChatServerEvent, ToolResult } from '@t-box/shared'
import type { ApplicationModule, ToolContext } from '../src/agent/contracts.js'
import type { ProviderInput, ProviderTurn } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '@t-box/server-foundation/errors'
import { defaultWorkflowPrompts } from '../src/agent-workflow/defaults.js'
import { createShellModule } from '../src/agent/builtins.js'
import { contextMemoryPrefix, contextUnits, estimateInputTokens, prepareContext } from '../src/agent/context.js'
import { portableHistory } from '../src/agent/history.js'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { definition } from '../src/agent/schema.js'
import { boundedToolHistory, modelToolResult, readToolResult } from '../src/agent/tool-results.js'
import { ChatService } from '../src/chat/engine.js'
import { MemorySessionRepository } from '../src/chat/session.js'

function moduleFor(id: string, size = 4): ApplicationModule {
  const names = Array.from({ length: size }, (_, index) => `${id}_action_${index}`)
  return {
    id,
    manifest: { id, name: `应用 ${id}`, description: `管理 ${id} 记录`, version: '1', icon: 'file', color: 'blue', skillIds: [`${id}_skill`] },
    navigation: { properties: { [`${id}Record`]: { type: 'string' } }, parse: () => ({}) },
    skills: { [`${id}_skill`]: { title: `${id}技能`, description: `处理 ${id} 记录`, instructions: `只处理 ${id} 的已授权操作。`, tools: names, version: '1' } },
    agents: [{ id, title: `${id}助手`, description: `处理 ${id}`, instructions: `专业助手 ${id}`, skillIds: [`${id}_skill`], version: '1' }],
    tools: Object.fromEntries(names.map((name) => [name, {
      definition: definition(name, `读取 ${name} 数据`, {}),
      title: name,
      execution: 'server' as const,
      effect: 'read' as const,
      successSummary: '已读取',
      handler: async () => ({ id: name }),
    }])),
  }
}
function setup(modules: ApplicationModule[], values: Record<string, number> = {}) {
  const registry = new CapabilityRegistry([...modules, createShellModule(modules)])
  const ctx = {
    registry,
    agentId: 'assistant',
    capabilities: { loadedTools: [], applications: [] },
    skills: new Set<string>(),
    modulePins: {},
    session: new MemorySessionRepository().create(),
    configurationSnapshot: { revision: 1, values },
    bindings: [],
    signal: new AbortController().signal,
  } as unknown as ToolContext
  return { registry, ctx }
}

test('admission estimates count transmitted content without duplicating private configuration or guard data', () => {
  const sent = { history: [{ role: 'user' as const, content: '你好' }], tools: [], instructions: '系统指导' }
  const runtime = { ...sent, configuration: { revision: 1, values: { 'ai.prompt.discovery': 'private'.repeat(10000) } }, confidentialInstructions: ['private'.repeat(10000)], execution: { operationId: 'internal' } }
  assert.equal(estimateInputTokens(runtime), estimateInputTokens(sent))
})

test('1600 tools do not enlarge the initial model catalog/schema; exact discovery only loads matching definitions', async () => {
  const small = setup([moduleFor('app_0', 8)])
  const large = setup(Array.from({ length: 200 }, (_, index) => moduleFor(`app_${index}`, 8)))
  const initial = await large.registry.availableTools(large.ctx)
  assert.equal(JSON.stringify(initial), JSON.stringify(await small.registry.availableTools(small.ctx)))
  assert.deepEqual(await large.registry.planningCatalog(large.ctx), [])
  const prompt = await large.registry.instructions(large.ctx, '2026-10-17', [])
  assert.equal(prompt, await small.registry.instructions(small.ctx, '2026-10-17', []))
  assert.ok(!prompt.includes('app_199'))
  const result = await large.registry.searchCapabilities('app_137_action_3', null, 0, large.ctx)
  assert.deepEqual(result.loadedTools, ['app_137_action_3'])
  const tools = await large.registry.availableTools(large.ctx)
  assert.ok(tools.some((tool) => tool.name === 'app_137_action_3'))
  assert.ok(!tools.some((tool) => tool.name === 'app_137_action_4'))
  const navigation = tools.find((tool) => tool.name === 'app_open')!
  assert.match(JSON.stringify(navigation), /app_137Record/)
  assert.ok(!JSON.stringify(navigation).includes('app_199Record'))
  assert.deepEqual((await large.registry.planningCatalog(large.ctx))[0]!.tools.map((tool) => tool.name), ['app_137_action_3'])
})

test('loading and search enforce installation and specialist scope, including discovery/catalog/navigation', async () => {
  const blocked = moduleFor('blocked')
  blocked.availability = async () => {
    throw new ApiError(403, 'APP_NOT_INSTALLED', '未安装')
  }
  const { registry, ctx } = setup([blocked, moduleFor('notes'), moduleFor('other')])
  const scope = registry.agentScope('notes')!
  Object.assign(ctx, { agentId: 'notes', applicationAllowlist: scope.applications, toolAllowlist: scope.tools, skillAllowlist: scope.skills })
  assert.equal((await registry.searchCapabilities('blocked', null, 0, ctx)).total, 0)
  assert.equal((await registry.searchCapabilities('other', null, 0, ctx)).total, 0)
  await assert.rejects(registry.loadTools(['other_action_0'], ctx), { code: 'TOOL_NOT_ALLOWED' })
  await registry.loadTools(['notes_action_0'], ctx)
  const tools = await registry.availableTools(ctx)
  assert.ok(!tools.some((tool) => ['agent_delegate', 'conversation_history_read'].includes(tool.name)))
  assert.ok(!JSON.stringify(await registry.planningCatalog(ctx)).includes('other_action'))
  assert.ok(!JSON.stringify(tools.find((tool) => tool.name === 'app_open')).includes('otherRecord'))
})

test('applications can expose standalone tools without implementing skills or importing the AI runtime', async () => {
  const module = moduleFor('standalone', 1)
  module.skills = {}
  module.agents = []
  module.manifest = { ...module.manifest!, skillIds: [] }
  const { registry, ctx } = setup([module])
  assert.ok(!(await registry.availableTools(ctx)).some((tool) => tool.name === 'standalone_action_0'))
  const result = await registry.searchCapabilities('standalone_action_0', null, 0, ctx)
  assert.deepEqual(result.loadedTools, ['standalone_action_0'])
  assert.ok((await registry.availableTools(ctx)).some((tool) => tool.name === 'standalone_action_0'))
  await registry.requireTool('standalone_action_0', {}, ctx)
  assert.equal(ctx.skills.size, 0)
})

test('count, schema, instruction and app budgets evict old definitions and remove unused skills', async () => {
  const { registry, ctx } = setup([moduleFor('one'), moduleFor('two'), moduleFor('three')], { 'ai.tools.maxLoaded': 2, 'ai.tools.maxApplications': 2 })
  await registry.loadTools(['one_action_0', 'two_action_0'], ctx)
  const next = await registry.loadTools(['three_action_0'], ctx)
  assert.deepEqual(next.evictedTools, ['one_action_0'])
  assert.ok(!ctx.skills.has('one_skill'))
  assert.equal(registry.isToolLoaded('one_action_0', ctx), false)
  await assert.rejects(registry.requireTool('one_action_0', {}, ctx), { code: 'TOOL_NOT_LOADED' })
  ctx.configurationSnapshot!.values['ai.tools.maxApplications'] = 1
  await assert.rejects(registry.loadTools(['one_action_0', 'two_action_0'], ctx), { code: 'TOOL_APPLICATION_LIMIT' })
  ctx.toolSchemaBudget = 1
  await assert.rejects(registry.loadTools(['one_action_0'], ctx), { code: 'TOOL_SCHEMA_LIMIT' })
  ctx.toolSchemaBudget = undefined
  const giant = setup([{ ...moduleFor('giant'), skills: { giant_skill: { ...moduleFor('giant').skills.giant_skill!, instructions: 'x'.repeat(20000) } } }])
  await assert.rejects(giant.registry.loadTools(['giant_action_0'], giant.ctx), { code: 'TOOL_INSTRUCTIONS_LIMIT' })
})

test('empty query supports bounded pagination and large skill activation does not flood tools', async () => {
  const { registry, ctx } = setup([moduleFor('notes', 40)], { 'ai.tools.maxLoaded': 2, 'ai.tools.searchPageSize': 2 })
  const first = await registry.searchCapabilities('', 'notes', 0, ctx)
  assert.equal(first.results.length, 2)
  assert.equal(first.nextOffset, 2)
  const second = await registry.searchCapabilities('', 'notes', 2, ctx)
  assert.ok(second.results.every((item) => !first.results.some((old) => old.name === item.name)))
  const skills = [...ctx.skills]
  const result = await registry.tools.skill_activate!.handler!({ skillId: 'notes_skill' }, ctx) as { loaded: boolean }
  assert.equal(result.loaded, false)
  assert.deepEqual([...ctx.skills], skills)
  assert.equal(ctx.capabilities!.loadedTools.length, 2)
})

test('durable discovery replay restores the same selection and rechecks revoked installs', async () => {
  let installed = true
  const module = moduleFor('notes')
  module.availability = async () => {
    if (!installed) {
      throw new ApiError(403, 'APP_NOT_INSTALLED', '未安装')
    }
    return 'release:1'
  }
  const { registry, ctx } = setup([module])
  const loaded = await registry.searchCapabilities('notes_action_2', null, 0, ctx)
  ctx.capabilities = { applications: [], loadedTools: [] }
  ctx.skills.clear()
  await registry.tools.capability_search!.restoreState!({ ok: true, data: loaded }, ctx)
  assert.deepEqual(ctx.capabilities.loadedTools, ['notes_action_2'])
  installed = false
  await assert.rejects(async () => {
    await registry.tools.capability_search!.restoreState!({ ok: true, data: loaded }, ctx)
  }, { code: 'APP_NOT_INSTALLED' })
})

test('large receipts use references, path paging preserves exact data and never re-runs a business tool', async () => {
  const { registry, ctx } = setup([moduleFor('notes')])
  const source: ToolResult = { ok: true, data: { items: Array.from({ length: 100 }, (_, id) => ({ id, text: '资料'.repeat(10000) })), text: '中文'.repeat(10000) } }
  ctx.session.calls.set('source', { fingerprint: 'notes_action_0:{}', result: source })
  ctx.session.messages.push({ id: 'answer', role: 'assistant', content: '已读取', createdAt: 'now', toolCalls: [{ id: 'source', name: 'notes_action_0', title: '查询', execution: 'server', status: 'completed' }] })
  const projected = modelToolResult(source, 'source')
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) < 12288)
  assert.ok(JSON.stringify(projected).includes('resultRef'))
  const page = await readToolResult('source', '/data/items', 20, 3, ctx)
  assert.equal(page.nextOffset, 23)
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 12288)
  assert.equal((page.value as any[])[0].resultRef.path, '/data/items/20')
  const item = await readToolResult('source', '/data/items/20/id', 0, 1, ctx)
  assert.equal(item.value, 20)
  let offset = 0
  let text = ''
  do {
    const part = await readToolResult('source', '/data/text', offset, 50, ctx)
    text += part.value
    assert.ok(Buffer.byteLength(JSON.stringify(part)) < 12288)
    offset = part.nextOffset ?? -1
  } while (offset >= 0)
  assert.equal(text, (source.data as { text: string }).text)
  await assert.rejects(readToolResult('source', '/data/__proto__', 0, 1, ctx), { code: 'TOOL_RESULT_PATH_NOT_FOUND' })
  ctx.session.calls.set('private', { fingerprint: 'skill_activate:{}', result: { ok: true, data: { instructions: 'private' } } })
  await assert.rejects(readToolResult('private', '', 0, 1, ctx), { code: 'TOOL_RESULT_NOT_FOUND' })
  const history = boundedToolHistory([{ type: 'function_call', call_id: 'source', name: 'notes_action_0', arguments: '{}' }, { type: 'function_call_output', call_id: 'source', output: JSON.stringify(source) }], ctx)
  assert.doesNotThrow(() => contextUnits(history))
  assert.ok(JSON.stringify(history).length < 13000)
  assert.equal((ctx.session.calls.get('source')!.result as any).data.items.length, 100)
  ctx.session.messages = []
  await assert.rejects(readToolResult('source', '/data/items', 0, 1, ctx), { code: 'TOOL_RESULT_NOT_FOUND' })
  assert.ok(registry.tools.tool_result_read)
})

test('public conversation retrieval is scoped, paginated and excludes private context/timeline', async () => {
  const { registry, ctx } = setup([])
  ctx.session.messages = Array.from({ length: 6 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: `公开消息 ${index}`, createdAt: 'now', toolCalls: [], timeline: [{ kind: 'analysis', text: '不应输出的内部时间线', id: 't' }] } as any))
  ctx.session.history = [{ role: 'assistant', content: 'PRIVATE_SUMMARY' }]
  const page = await registry.tools.conversation_history_read!.handler!({ query: null, beforeMessageId: null, limit: 2 }, ctx) as any
  assert.deepEqual(page.messages.map((message: any) => message.id), ['m4', 'm5'])
  assert.equal(page.nextBeforeMessageId, 'm4')
  assert.ok(!JSON.stringify(page).includes('PRIVATE_SUMMARY'))
  assert.ok(!JSON.stringify(page).includes('内部时间线'))
  const original = '中文🙂'.repeat(2000)
  ctx.session.messages[0]!.content = original
  let offset: number | null = 0
  let recovered = ''
  do {
    const part = await registry.tools.conversation_history_read!.handler!({ messageId: 'm0', offset }, ctx) as any
    recovered += part.messages[0].content
    offset = part.messages[0].nextOffset
  } while (offset !== null)
  assert.equal(recovered, original)
  ctx.agentId = 'specialist'
  await assert.rejects(registry.tools.conversation_history_read!.handler!({ query: '', beforeMessageId: null, limit: 2 }, ctx) as Promise<unknown>)
})

test('portable model switches retain rolling memory and complete receipts, but discard provider opaque state', () => {
  const history = portableHistory([
    { role: 'assistant', content: contextMemoryPrefix + '原事实摘要' },
    { type: 'reasoning', id: 'private-id', encrypted_content: 'private-state', summary: [] },
    { type: 'function_call', id: 'provider-function-id', call_id: 'call', name: 'notes_action_0', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call', output: '{"ok":true}' },
    { type: 'message', role: 'assistant', status: 'completed', id: 'provider-message-id', content: [{ type: 'output_text', text: '完成', annotations: [] }] },
  ])!
  assert.ok(JSON.stringify(history).includes('原事实摘要'))
  assert.ok(!JSON.stringify(history).includes('private-state'))
  assert.ok(!JSON.stringify(history).includes('provider-function-id'))
  assert.ok(!JSON.stringify(history).includes('provider-message-id'))
  assert.doesNotThrow(() => contextUnits(history))
  assert.equal(portableHistory([{ type: 'compaction', encrypted_content: 'opaque' }]), undefined)
  assert.equal(portableHistory([{ type: 'item_reference', id: 'private-provider-item' }]), undefined)
})

test('repeated summaries carry prior memory as memory rather than re-reading raw archives', async () => {
  const history = [
    { role: 'assistant' as const, content: contextMemoryPrefix + '已核实旧事实，回执 call-old。' },
    ...Array.from({ length: 30 }, (_, index) => [{ role: 'user' as const, content: `${index} ${'新事实'.repeat(150)}` }, { role: 'assistant' as const, content: '回答'.repeat(150) }]).flat(),
  ]
  const requests: ProviderInput[] = []
  const state = { compactions: 2 }
  const result = await prepareContext({ mode: 'openai', contextPolicy: { maxInputTokens: 32768, compaction: false, promptCacheKey: false, compactionMode: 'summary', keepRecentTurns: 4, summaryTargetTokens: 1024 }, next: async () => {
    throw new Error('unused')
  }, summarize: async (input) => {
    requests.push(input)
    return '合并后事实、用户最新更正及真实回执。'
  } }, { history, tools: [], instructions: '', signal: new AbortController().signal, localDate: '2026-10-17', onDelta() {} }, { state })
  assert.equal(result.compacted, true)
  const payload = JSON.parse((requests[0]!.history[0] as { content: string }).content)
  assert.equal(payload.previousMemory, '已核实旧事实，回执 call-old。')
  assert.ok(!payload.chronologicalItems.includes(contextMemoryPrefix))
  assert.equal(state.compactions, 3)
  assert.ok(result.history.slice(-8).some((item) => 'content' in item && String(item.content).includes('29 ')))
})

test('deferred runtime discovers during planning, executes once, and keeps simple answers in one call', async (t) => {
  let writes = 0
  const module = moduleFor('notes', 1)
  module.skills = {}
  module.agents = []
  module.manifest = { ...module.manifest!, skillIds: [] }
  module.tools.notes_action_0!.handler = async () => ({ writes: ++writes })
  const { registry } = setup([module, ...Array.from({ length: 40 }, (_, index) => moduleFor(`extra_${index}`, 10))])
  const events: ChatServerEvent[] = []
  const call = (id: string, name: string, args: unknown): ProviderTurn => ({ calls: [{ id, name, arguments: JSON.stringify(args) }], output: [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }] })
  let rounds = 0
  const service = new ChatService({
    registry,
    capabilityLoading: 'deferred',
    workflow: { snapshot: async () => ({ revision: 1, updatedAt: 'now', prompts: defaultWorkflowPrompts }) },
    provider: { mode: 'openai', async next(input) {
      const current = rounds++
      if (current === 0) {
        assert.ok(!JSON.stringify(input.instructions).includes('extra_39_action'))
        assert.ok(input.tools.some((tool) => tool.name === 'capability_search'))
        return call('discover', 'capability_search', { query: 'notes_action_0', appId: null, offset: null })
      }
      if (current === 1) {
        assert.match(input.instructions, /notes_action_0/)
        return call('plan', 'workflow_plan', { route: 'execute', summary: '查询笔记', steps: ['查询'], requiredTools: ['notes_action_0'], verification: 'model' })
      }
      if (current === 2) {
        assert.ok(input.tools.some((tool) => tool.name === 'notes_action_0'))
        assert.ok(!input.tools.some((tool) => tool.name === 'extra_39_action_0'))
        return call('execute', 'notes_action_0', {})
      }
      if (current === 3) {
        return { calls: [], output: [{ role: 'assistant', content: '已读取' }] }
      }
      if (current === 4) {
        return call('review', 'workflow_review', { action: 'complete', summary: '回执已核对', next: '' })
      }
      input.onDelta(current === 5 ? '查询完成' : '2')
      return { calls: [], output: [{ role: 'assistant', content: current === 5 ? '查询完成' : '2' }] }
    } },
  })
  t.after(() => service.close())
  const connection = service.connect((event) => events.push(event))
  await connection.receive({ type: 'session.open' })
  const send = (text: string, requestId: string) => connection.receive({ type: 'message.send', requestId, text, localDate: '2026-10-17' })
  const wait = async (count: number) => {
    const deadline = Date.now() + 5000
    while (events.filter((event) => event.type === 'run.finished').length < count) {
      assert.ok(Date.now() < deadline, 'runtime completion timed out')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  await send('读取我的笔记', 'run-1')
  await wait(1)
  assert.equal(writes, 1)
  assert.equal(rounds, 6)
  const result = events.findLast((event) => event.type === 'run.finished') as Extract<ChatServerEvent, { type: 'run.finished' }>
  assert.equal(result.snapshot.messages.at(-1)?.content, '查询完成')
  assert.equal(result.snapshot.messages.at(-1)?.outcome, 'completed')
  await send('1+1=?', 'run-2')
  await wait(2)
  assert.equal(rounds, 7)
  assert.equal(writes, 1)
})

test('a model stuck in discovery is bounded before business execution', async (t) => {
  const { registry } = setup([moduleFor('notes', 1)])
  const events: ChatServerEvent[] = []
  let calls = 0
  const service = new ChatService({
    registry,
    capabilityLoading: 'deferred',
    configuration: { snapshot: async () => ({ revision: 1, values: { 'ai.tools.discoveryRounds': 2 } }) },
    workflow: { snapshot: async () => ({ revision: 1, updatedAt: 'now', prompts: defaultWorkflowPrompts }) },
    provider: { mode: 'openai', async next() {
      const id = `discover-${++calls}`
      const args = JSON.stringify({ query: '', appId: 'notes', offset: null })
      return { calls: [{ id, name: 'capability_search', arguments: args }], output: [{ type: 'function_call', call_id: id, name: 'capability_search', arguments: args }] }
    } },
  })
  t.after(() => service.close())
  const connection = service.connect((event) => events.push(event))
  await connection.receive({ type: 'session.open' })
  await connection.receive({ type: 'message.send', requestId: 'bounded-search', text: '查询笔记', localDate: '2026-10-17' })
  const deadline = Date.now() + 3000
  while (!events.some((event) => event.type === 'run.finished')) {
    assert.ok(Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const result = events.findLast((event) => event.type === 'run.finished') as Extract<ChatServerEvent, { type: 'run.finished' }>
  assert.equal(result.snapshot.messages.at(-1)?.error?.code, 'CAPABILITY_DISCOVERY_LIMIT')
  assert.equal(calls, 3)
  assert.ok(!result.snapshot.messages.at(-1)?.toolCalls.some((tool) => tool.name === 'notes_action_0'))
})
