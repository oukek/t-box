import type { ChatMessage } from '@t-box/shared'
import type { AgentFrame, RunCheckpoint } from '../src/agent/checkpoint.js'
import type { ChatProvider, ProviderItem } from '../src/chat/provider.js'
import type { ChatSession } from '../src/chat/session.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { failoverHistory, switchFailedModel } from '../src/agent/model-failover.js'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { ErrorCode } from '../src/error-codes.js'

const frame = (history: ProviderItem[], agentId = 'assistant'): AgentFrame => ({
  agentId,
  history,
  skills: [],
  rounds: 1,
  calls: [],
  content: '',
  done: false,
})
const message = (id: string, role: ChatMessage['role'], content: string): ChatMessage => ({
  id,
  role,
  content,
  createdAt: '2026-10-29T00:00:00Z',
  toolCalls: [],
})
const registry = new CapabilityRegistry([])
function fixture(frames: AgentFrame[]) {
  const user = message('user', 'user', 'Create one timer; do not create a second one.')
  const answer = message('answer', 'assistant', '')
  const session = {
    messages: [user, answer],
    calls: new Map(),
    requests: new Map(),
    history: frames[0]!.history,
    configurationKey: 'old',
    contextState: { lastAfterTokens: 1234 },
  } as unknown as ChatSession
  const state = { assistantId: answer.id, frames } as RunCheckpoint
  return { session, state, answer }
}
test('switching models removes private IDs/reasoning and retains complete tool receipts for every frame', async () => {
  const root = frame([
    { role: 'user', content: 'timer' },
    { type: 'reasoning', id: 'private-reasoning', summary: [], encrypted_content: 'private' },
    { type: 'function_call', id: 'private-item', call_id: 'timer', name: 'time_timer_create', arguments: '{}' },
    { type: 'function_call_output', call_id: 'timer', output: '{"ok":true}' },
    { type: 'message', role: 'assistant', id: 'private-message', content: [{ type: 'output_text', text: 'Created', annotations: [] }], status: 'completed' },
  ])
  root.contextState = { lastAfterTokens: 1234 }
  root.modelRequestKey = 'stable-logical-turn'
  root.modelRequests = { 'stable-logical-turn': { id: 'logical', retries: 2, status: 'in_flight' } }
  root.modelFailover = { pending: true, modelIds: ['failed'], providerIds: ['upstream'] }
  const child = frame([{ role: 'user', content: 'specialist-only task' }], 'time')
  const { session, state } = fixture([root, child])
  const replacement: ChatProvider = { mode: 'openai', configurationKey: 'new', async next() {
    throw new Error('unused')
  } }
  const original: ChatProvider = {
    mode: 'openai',
    configurationKey: 'old',
    async next() {
      throw new Error('unused')
    },
    async failover(options) {
      assert.deepEqual(options.excludeModelIds, ['failed'])
      assert.deepEqual(options.avoidProviderIds, ['upstream'])
      return replacement
    },
  }
  assert.equal(await switchFailedModel(original, state, root, session, registry), replacement)
  assert.equal(session.configurationKey, 'new')
  assert.equal(session.history, root.history)
  assert.equal(JSON.stringify(root.history).includes('private'), false)
  assert.deepEqual(root.history.slice(1, 3), [
    { type: 'function_call', call_id: 'timer', name: 'time_timer_create', arguments: '{}' },
    { type: 'function_call_output', call_id: 'timer', output: '{"ok":true}' },
  ])
  assert.deepEqual(child.history, [{ role: 'user', content: 'specialist-only task' }])
  assert.deepEqual(root.contextState, {})
  assert.deepEqual(session.contextState, {})
  assert.equal(root.modelRequests['stable-logical-turn']!.retries, 2)
  assert.equal(root.modelRequestKey, 'stable-logical-turn')
  assert.equal(root.modelFailover.pending, false)
})
test('opaque specialist history rebuilds only that specialist’s receipts and preserves the pending parent delegation', () => {
  const parent = frame([{ type: 'compaction', id: 'opaque-parent', encrypted_content: 'parent-secret' }])
  parent.calls = [{ id: 'delegate', name: 'agent_delegate', arguments: JSON.stringify({ agentId: 'time', task: 'Create one timer' }) }]
  parent.receiptIds = ['delegate', 'root-only']
  const child = frame([{ type: 'compaction', id: 'opaque-child', encrypted_content: 'child-secret' }], 'time')
  child.parentCallId = 'delegate'
  child.receiptIds = ['timer']
  const { state, session, answer } = fixture([parent, child])
  answer.toolCalls = [
    { id: 'root-only', name: 'other_app_secret', title: 'Root only', execution: 'server', status: 'completed' },
    { id: 'delegate', name: 'agent_delegate', title: 'Delegate', execution: 'server', status: 'running' },
    { id: 'timer', name: 'time_timer_create', title: 'Timer', execution: 'server', status: 'completed' },
  ]
  session.calls.set('timer', { fingerprint: 'time_timer_create:{"label":"Once"}', result: { ok: true, data: { id: 'created-timer' } } })
  const [rootHistory, childHistory] = failoverHistory(state, session, registry)
  assert.equal(JSON.stringify(childHistory).includes('root-only'), false)
  assert.equal(JSON.stringify(childHistory).includes('other_app_secret'), false)
  assert.equal(JSON.stringify(childHistory).includes('secret'), false)
  assert.ok(JSON.stringify(childHistory).includes('created-timer'))
  assert.ok(JSON.stringify(childHistory).includes('Create one timer'))
  assert.ok(rootHistory!.some((item) => item.type === 'function_call' && item.call_id === 'delegate'))
  assert.ok(!rootHistory!.some((item) => item.type === 'function_call_output' && item.call_id === 'delegate'))
  assert.ok(!rootHistory!.some((item) => (item.type === 'function_call' || item.type === 'function_call_output') && item.call_id === 'timer'))
})
test('no compatible replacement leaves the existing checkpoint untouched', async () => {
  const root = frame([{ role: 'user', content: [{ type: 'input_image', image_url: 'tbox-resource:image', detail: 'auto' }] }])
  root.modelFailover = { pending: true, modelIds: ['vision'], providerIds: ['upstream'] }
  const { state, session } = fixture([root])
  const before = structuredClone(state)
  const provider: ChatProvider = {
    mode: 'openai',
    async next() {
      throw new Error('unused')
    },
    async failover(options) {
      assert.equal(options.supportsVision, true)
      throw ErrorCode.MODEL_POOL_UNAVAILABLE()
    },
  }
  await assert.rejects(switchFailedModel(provider, state, root, session, registry), { code: 'MODEL_POOL_UNAVAILABLE' })
  assert.deepEqual(state, before)
  assert.equal(session.configurationKey, 'old')
})
test('canceling during replacement selection cannot migrate or call the next model', async () => {
  const root = frame([{ role: 'user', content: 'timer' }])
  root.modelFailover = { pending: true, modelIds: ['old'], providerIds: ['upstream'] }
  const { state, session } = fixture([root])
  const before = structuredClone(state)
  const controller = new AbortController()
  const replacement: ChatProvider = { mode: 'openai', configurationKey: 'new', async next() {
    assert.fail('Canceled requests cannot invoke a replacement')
  } }
  const provider: ChatProvider = {
    ...replacement,
    configurationKey: 'old',
    async failover() {
      controller.abort('CANCELLED')
      return replacement
    },
  }
  await assert.rejects(switchFailedModel(provider, state, root, session, registry, undefined, controller.signal))
  assert.deepEqual(state, before)
  assert.equal(session.configurationKey, 'old')
})
