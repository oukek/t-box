import type { ConfigurationSnapshot } from '@t-box/shared'
import type {
  ChatProvider,
  ProviderInput,
  ProviderItem,
} from '../chat/provider.js'
import { platformDefinitions } from '../configuration/defaults.js'
import { ErrorCode } from '../error-codes.js'
import { DisclosureFilter } from './disclosure.js'
import { secureInstructions, systemSecurityPolicy } from './policy.js'

interface ProtectedConfiguration {
  apiKey: string
  model: string
  modelName: string
  providerName: string
  baseURL?: string
  configuration?: ConfigurationSnapshot
}

/** Outside metering/auditing: keep original diagnostics server-side and gate output before dispatch. */
export class ProtectedChatProvider implements ChatProvider {
  readonly mode
  readonly configurationKey
  readonly contextPolicy
  readonly maxOutputTokens
  constructor(
    private readonly inner: ChatProvider,
    private readonly configuration: ProtectedConfiguration,
  ) {
    this.mode = inner.mode
    this.configurationKey = inner.configurationKey
    this.contextPolicy = inner.contextPolicy
    this.maxOutputTokens = inner.maxOutputTokens
  }

  private filter(input: {
    configuration?: ConfigurationSnapshot
    confidentialInstructions?: string[]
  }) {
    const config = this.configuration
    // Short remote model IDs (e.g. o3) still need protection; short display
    // labels are too ambiguous to treat as private substrings in ordinary text.
    const identities = [
      config.model,
      ...[config.modelName, config.providerName, config.baseURL || ''].filter(
        (value) => value.length >= 4,
      ),
    ]
    try {
      identities.push(new URL(config.baseURL!).hostname)
    } catch {
      /* No configured endpoint. */
    }
    const values = (input.configuration ?? config.configuration)?.values || {}
    const prompts = platformDefinitions
      .filter((definition) => definition.key.startsWith('ai.prompt.'))
      .map((definition) =>
        String(values[definition.key] ?? definition.defaultValue),
      )
    return new DisclosureFilter(
      [config.apiKey],
      [
        systemSecurityPolicy,
        ...prompts,
        ...(input.confidentialInstructions || []),
      ],
      identities,
    )
  }

  private input(input: ProviderInput, filter: DisclosureFilter) {
    let stream: ReturnType<DisclosureFilter['stream']> | undefined
    const finish = () => stream?.finish()
    return {
      finish,
      input: {
        ...input,
        instructions: secureInstructions(input.instructions),
        // Provider reasoning summaries are not the public analysis protocol.
        // Only explicit, user-facing analysis/action summaries may be streamed.
        publicReasoning: false,
        onReasoning: undefined,
        onDelta: (text: string, id?: string) => {
          // One logical public stream per turn, including gateway item changes.
          // Flushing on an item boundary could expose a split secret.
          if (!stream) {
            stream = filter.stream((safe) => input.onDelta(safe, id))
          }
          stream.push(text)
        },
      } satisfies ProviderInput,
    }
  }

  async next(input: ProviderInput) {
    const filter = this.filter(input)
    const guarded = this.input(input, filter)
    const turn = await this.inner.next(guarded.input)
    // A tool can write a file, create an image or contact another service. Never
    // silently edit its arguments: block the entire batch before any tool runs.
    for (const call of turn.calls) {
      let args: unknown = call.arguments
      try {
        args = JSON.parse(call.arguments)
      } catch {
        /* Ordinary dispatch reports malformed JSON. */
      }
      if (filter.contains(args) || filter.contains(call.name)) {
        throw ErrorCode.AI_DISCLOSURE_BLOCKED()
      }
    }
    guarded.finish()
    return { ...turn, output: this.output(turn.output, filter) }
  }

  private output(
    items: ProviderItem[],
    filter: DisclosureFilter,
  ): ProviderItem[] {
    return items.map((item) => {
      if (item.type === 'reasoning') {
        // Keep opaque provider state for continuity; no reasoning summary is public.
        return { ...item, summary: [] }
      }
      if (
        'role' in item &&
        item.role === 'assistant' &&
        typeof item.content === 'string'
      ) {
        return { ...item, content: filter.mask(item.content) }
      }
      if (item.type === 'message' && Array.isArray(item.content)) {
        return {
          ...item,
          content: item.content.map((part) => {
            if ('text' in part && typeof part.text === 'string') {
              return { ...part, text: filter.mask(part.text) }
            }
            if ('refusal' in part && typeof part.refusal === 'string') {
              return { ...part, refusal: filter.mask(part.refusal) }
            }
            return part
          }),
        } as ProviderItem
      }
      return item
    })
  }

  async summarize(input: ProviderInput) {
    if (!this.inner.summarize) {
      throw ErrorCode.SUMMARY_UNSUPPORTED()
    }
    const filter = this.filter(input)
    return filter.mask(
      await this.inner.summarize(this.input(input, filter).input),
    )
  }

  async compact(input: ProviderInput) {
    if (!this.inner.compact) {
      throw ErrorCode.COMPACTION_DISABLED()
    }
    // Native encrypted compaction items are private state; do not alter them.
    return this.inner.compact(this.input(input, this.filter(input)).input)
  }

  async countInputTokens(input: ProviderInput) {
    if (!this.inner.countInputTokens) {
      throw ErrorCode.TOKEN_COUNT_UNSUPPORTED()
    }
    return this.inner.countInputTokens(
      this.input(input, this.filter(input)).input,
    )
  }

  async title(input: Parameters<NonNullable<ChatProvider['title']>>[0]) {
    if (!this.inner.title) {
      return ''
    }
    return this.filter(input).mask(
      await this.inner.title({
        ...input,
        instructions: secureInstructions(input.instructions || ''),
      }),
    )
  }
}
