import type { ModelInvocationMode } from '@t-box/shared'
import type OpenAI from 'openai'
import type { ChatProvider, OpenAIProviderOptions } from './provider.js'
import { ApiError } from '@t-box/server-foundation/errors'
import { OpenAIChatCompletionsProvider } from './chat-completions-provider.js'
import {
  OpenAIResponsesProvider,
} from './provider.js'

export function createConversationProvider(
  options: OpenAIProviderOptions & { invocationMode?: ModelInvocationMode },
  client?: OpenAI,
): ChatProvider {
  switch (options.invocationMode ?? 'responses') {
    case 'responses':
      return new OpenAIResponsesProvider(options, client)
    case 'chat_completions':
      return new OpenAIChatCompletionsProvider(options, client)
    default:
      throw new ApiError(
        503,
        'INVALID_INVOCATION_MODE',
        '普通会话模型的调用方式配置无效',
      )
  }
}
