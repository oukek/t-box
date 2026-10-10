import type { ContextPolicy, ModelInvocationMode } from '@t-box/shared'
import { ApiError } from '@t-box/server-foundation/errors'

export function invocationMode(
  value: unknown,
  purpose: 'conversation' | 'image',
): ModelInvocationMode {
  const mode = value ?? (purpose === 'image' ? 'images' : 'responses')
  if (
    typeof mode !== 'string' ||
    (purpose === 'image'
      ? mode !== 'images'
      : !['responses', 'chat_completions'].includes(mode))
  ) {
    throw new ApiError(
      400,
      'INVALID_INVOCATION_MODE',
      '调用方式与模型用途不匹配',
    )
  }
  return mode as ModelInvocationMode
}

/** Chat Completions has neither Responses token counting nor native compaction. */
export function invocationContextPolicy<T extends ContextPolicy>(
  mode: ModelInvocationMode,
  policy: T,
): T {
  return mode === 'chat_completions'
    ? {
        ...policy,
        tokenCounting: false,
        compactionMode:
          policy.compactionMode === 'native'
            ? 'summary'
            : policy.compactionMode,
      }
    : policy
}
