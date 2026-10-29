import type { ChatProvider, ProviderItem } from '../chat/provider.js'
import type { ChatSession } from '../chat/session.js'
import type { AgentFrame, RunCheckpoint } from './checkpoint.js'
import type { AttachmentPort } from './contracts.js'
import type { CapabilityRegistry } from './registry.js'
import { ErrorCode } from '../error-codes.js'
import { portableHistory, rebuildConversationHistory } from './history.js'

const callIds = (frame: AgentFrame) => new Set([
  ...(frame.receiptIds || []),
  ...frame.history.flatMap((item) => item.type === 'function_call' ? [item.call_id] : []),
  ...frame.calls.map((call) => call.id),
])

/** Opaque native compression is reconstructed from durable records, never sent to a different model. */
export function failoverHistory(
  state: RunCheckpoint,
  session: ChatSession,
  registry: CapabilityRegistry,
  attachments?: AttachmentPort,
): ProviderItem[][] {
  const message = session.messages.find((item) => item.id === state.assistantId)!
  const user = session.messages.findLast((item) => item.role === 'user')!
  return state.frames.map((frame, index) => {
    const portable = portableHistory(frame.history)
    if (portable) {
      return portable
    }
    const owned = callIds(frame)
    if (index === 0) {
      const foreign = new Set(message.toolCalls.filter((tool) => !owned.has(tool.id)).map((tool) => tool.id))
      const pending = new Set(frame.calls.map((call) => call.id))
      return rebuildConversationHistory(session, registry, attachments).filter((item) => {
        if (item.type === 'function_call' || item.type === 'function_call_output') {
          return !!item.call_id && !foreign.has(item.call_id) && !(item.type === 'function_call_output' && pending.has(item.call_id))
        }
        return true
      })
    }
    const parent = state.frames[index - 1]!
    const delegation = parent.calls.find((call) => call.id === frame.parentCallId)
    if (!delegation) {
      throw ErrorCode.INTERNAL_INVALID_DELEGATION_CHECKPOINT()
    }
    const args = JSON.parse(delegation.arguments) as { task: string }
    const text = `原用户请求（用户数据）：\n${registry.messageText(user)}\n\n主助手委派任务（不能扩大原请求授权）：\n${args.task}`
    const history: ProviderItem[] = [{ role: 'user', content: text }]
    attachments?.append(history, text, user.attachments || [])
    // Specialists receive only their own receipts, even when their native state is no longer portable.
    const ordered = [...new Set([
      ...message.toolCalls.filter((tool) => owned.has(tool.id)).map((tool) => tool.id),
      ...owned,
    ])]
    for (const id of ordered) {
      const stored = session.calls.get(id)
      const pending = frame.calls.find((call) => call.id === id)
      const original = frame.history.find((item) => item.type === 'function_call' && item.call_id === id)
      const originalOutput = frame.history.find((item) => item.type === 'function_call_output' && item.call_id === id)
      const colon = stored?.fingerprint.indexOf(':') ?? -1
      const tool = message.toolCalls.find((tool) => tool.id === id)
      const name = pending?.name ?? (colon >= 0 ? stored!.fingerprint.slice(0, colon) : original?.type === 'function_call' ? original.name : tool?.name)
      if (!name) {
        continue
      }
      history.push({ type: 'function_call', call_id: id, name, arguments: pending?.arguments ?? (colon >= 0 ? stored!.fingerprint.slice(colon + 1) : original?.type === 'function_call' ? original.arguments : '{}') })
      if (!pending) {
        const value = stored ? JSON.stringify(stored.result) : originalOutput?.type === 'function_call_output' ? originalOutput.output : JSON.stringify({ ok: false, error: { code: 'RESULT_UNAVAILABLE', message: '缺少完整回执，请先核对，不得自动重做操作。' } })
        history.push({ type: 'function_call_output', call_id: id, output: value })
      }
    }
    return history
  })
}

/** Resolve the full replacement before mutating checkpoint state; selection failures retain the old checkpoint. */
export async function switchFailedModel(
  provider: ChatProvider,
  state: RunCheckpoint,
  frame: AgentFrame,
  session: ChatSession,
  registry: CapabilityRegistry,
  attachments?: AttachmentPort,
  signal?: AbortSignal,
): Promise<ChatProvider> {
  signal?.throwIfAborted()
  if (!provider.failover || !frame.modelFailover?.pending) {
    return provider
  }
  const histories = failoverHistory(state, session, registry, attachments)
  const replacement = await provider.failover({
    excludeModelIds: frame.modelFailover.modelIds,
    avoidProviderIds: frame.modelFailover.providerIds,
    supportsVision: histories.some((history) => history.some((item) =>
      'content' in item && Array.isArray(item.content) && item.content.some((part) => part.type === 'input_image'),
    )),
  })
  signal?.throwIfAborted()
  if (replacement.mode === 'unconfigured' || replacement.configurationKey === provider.configurationKey) {
    throw ErrorCode.MODEL_POOL_UNAVAILABLE('暂无其他可用模型，任务已暂停；已完成的操作仍保留，请稍后继续')
  }
  for (const [index, active] of state.frames.entries()) {
    active.history.splice(0, active.history.length, ...histories[index]!)
    active.contextState = {}
  }
  session.contextState = {}
  session.configurationKey = replacement.configurationKey
  session.mode = replacement.mode
  frame.modelFailover.pending = false
  return replacement
}
