import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import type { ProviderItem } from './provider.js'
import { ApiError } from '@t-box/server-foundation/errors'

function invalid(): never {
  throw new ApiError(
    409,
    'CHAT_HISTORY_INVALID',
    '会话上下文包含不兼容或不完整的工具记录，请新建对话',
  )
}

/** Keep persisted history transport-neutral: only the adapter translates wire format. */
export function chatMessages(
  history: ProviderItem[],
  instructions: string,
  supportsVision?: boolean,
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: instructions },
  ]
  const pending = new Set<string>()
  const seen = new Set<string>()
  for (const item of history) {
    if (item.type === 'reasoning') {
      continue
    } // Encrypted Responses reasoning is not portable.
    if (item.type === 'function_call') {
      if (!item.call_id || seen.has(item.call_id)) {
        invalid()
      }
      const last = messages.at(-1)
      // Multiple calls in one provider turn must share an assistant message.
      const assistant = last?.role === 'assistant' ? last : undefined
      const call = {
        id: item.call_id,
        type: 'function' as const,
        function: { name: item.name, arguments: item.arguments },
      }
      if (assistant) {
        assistant.tool_calls = [...(assistant.tool_calls ?? []), call]
      } else {
        if (pending.size) {
          invalid()
        }
        messages.push({ role: 'assistant', content: null, tool_calls: [call] })
      }
      seen.add(item.call_id)
      pending.add(item.call_id)
      continue
    }
    if (item.type === 'function_call_output') {
      if (!item.call_id || !pending.delete(item.call_id)) {
        invalid()
      }
      const content =
        typeof item.output === 'string'
          ? item.output
          : item.output
              .map((part) => {
                if (part.type !== 'input_text') {
                  return invalid()
                }
                return part.text
              })
              .join('\n')
      messages.push({ role: 'tool', tool_call_id: item.call_id, content })
      continue
    }
    if (pending.size || !('role' in item) || !('content' in item)) {
      invalid()
    }
    const role = item.role
    if (!['user', 'assistant', 'system', 'developer'].includes(role)) {
      invalid()
    }
    const parts: ChatCompletionContentPart[] = []
    if (typeof item.content === 'string') {
      parts.push({ type: 'text', text: item.content })
    } else {
      for (const part of item.content) {
        if (part.type === 'input_text' || part.type === 'output_text') {
          parts.push({ type: 'text', text: part.text })
        } else if (part.type === 'refusal') {
          parts.push({ type: 'text', text: part.refusal })
        } else if (
          part.type === 'input_image' &&
          role === 'user' &&
          part.image_url
        ) {
          if (supportsVision === false) {
            throw new ApiError(
              409,
              'VISION_MODEL_REQUIRED',
              '当前普通会话模型未启用看图能力，请在后台启用看图或切换模型',
            )
          }
          parts.push({
            type: 'image_url',
            image_url: { url: part.image_url, detail: part.detail },
          })
        } else {
          invalid()
        }
      }
    }
    if (role === 'user') {
      messages.push({ role, content: parts })
    } else {
      if (parts.some((p) => p.type !== 'text')) {
        invalid()
      }
      const content = parts
        .map((p) => (p.type === 'text' ? p.text : ''))
        .join('\n')
      messages.push({ role, content } as ChatCompletionMessageParam)
    }
  }
  if (pending.size) {
    invalid()
  }
  return messages
}
