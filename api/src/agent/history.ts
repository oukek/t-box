import type { ProviderItem } from '../chat/provider.js'
import type { ChatSession } from '../chat/session.js'
import type { AttachmentPort } from './contracts.js'
import type { CapabilityRegistry } from './registry.js'

/** Textual rolling memory is portable; opaque provider state is not. */
export function portableHistory(history: ProviderItem[]): ProviderItem[] | undefined {
  if (history.some((item) => item.type && !['reasoning', 'function_call', 'function_call_output', 'message'].includes(item.type))) {
    return undefined
  }
  return history.flatMap((item): ProviderItem[] => {
    if (item.type === 'reasoning') {
      return []
    }
    if (item.type === 'function_call') {
      return [{ type: 'function_call', call_id: item.call_id, name: item.name, arguments: item.arguments }]
    }
    if (item.type === 'function_call_output') {
      return [{ type: 'function_call_output', call_id: item.call_id, output: item.output }]
    }
    if ('role' in item && item.role === 'assistant' && Array.isArray(item.content)) {
      const content = item.content.flatMap((part) => 'text' in part ? [part.text] : 'refusal' in part ? [part.refusal] : []).join('\n')
      return content ? [{ role: 'assistant', content }] : []
    }
    return [item]
  })
}
/** Rehydrate portable history without treating visible candidate text as evidence of successful writes. */
export function rebuildConversationHistory(
  session: ChatSession,
  registry: CapabilityRegistry,
  attachments?: AttachmentPort,
): ProviderItem[] {
  const history: ProviderItem[] = session.branch?.executionContext
    ? [{ role: 'assistant', content: session.branch.executionContext }]
    : []
  for (const message of session.messages) {
    if (message.role === 'assistant') {
      const tools = new Map(
        [
          ...(session.answerRetryEvidence?.[message.id]?.toolCalls || []),
          ...message.toolCalls,
        ].map((tool) => [tool.id, tool]),
      )
      for (const tool of tools.values()) {
        const stored = session.calls.get(tool.id)
        const colon = stored?.fingerprint.indexOf(':') ?? -1
        const name =
          colon >= 0 ? stored!.fingerprint.slice(0, colon) : tool.name
        const args = colon >= 0 ? stored!.fingerprint.slice(colon + 1) : '{}'
        history.push(
          { type: 'function_call', call_id: tool.id, name, arguments: args },
          {
            type: 'function_call_output',
            call_id: tool.id,
            output: JSON.stringify(
              stored?.result ?? {
                ok: false,
                error: {
                  code: 'RESULT_UNAVAILABLE',
                  message: '缺少完整回执，请先核对，不得自动重做操作。',
                },
              },
            ),
          },
        )
      }
    }
    const text = registry.messageText(message)
    if (text || message.role === 'user') {
      history.push({ role: message.role, content: text })
    }
    if (message.role === 'user') {
      attachments?.append(history, text, message.attachments || [])
    }
  }
  return history
}
