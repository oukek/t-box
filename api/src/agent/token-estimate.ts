import type { ProviderInput } from '../chat/provider.js'
import { createHash } from 'node:crypto'
import { Tiktoken } from 'js-tiktoken/lite'
import ranks from 'js-tiktoken/ranks/cl100k_base'

type ModelInput = Pick<ProviderInput, 'history' | 'tools' | 'instructions'>
let tokenizer: Tiktoken | undefined
const tokenCounts = new Map<string, number>()

function textTokens(text: string): number {
  tokenizer ??= new Tiktoken(ranks)
  let count = 0
  // Bound BPE work on very long words/repeated characters. Splits may slightly
  // overcount boundary merges, but never truncate input or block on quadratic work.
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 128, text.length)
    const code = text.charCodeAt(end - 1)
    if (end < text.length && code >= 0xD800 && code <= 0xDBFF) {
      end--
    }
    const part = text.slice(start, end)
    // Cache counts, not user text; bounded across all concurrent conversations.
    const key = createHash('sha256').update(part).digest('hex')
    let size = tokenCounts.get(key)
    if (size === undefined) {
      size = tokenizer.encode(part, [], []).length
      if (tokenCounts.size >= 2048) {
        tokenCounts.delete(tokenCounts.keys().next().value!)
      }
      tokenCounts.set(key, size)
    }
    count += size
    start = end
  }
  return count
}

function projection(input: ModelInput) {
  let images = 0
  // Pick does not remove runtime properties: never count server snapshots or callbacks.
  const text = JSON.stringify(
    { history: input.history, tools: input.tools, instructions: input.instructions },
    (key, value: unknown) => {
      if (key === 'image_url' && typeof value === 'string') {
        images++
        return '[image]'
      }
      return value
    },
  )
  return { text, images }
}

/** Portable text estimate, not provider usage. Different model tokenizers can differ. */
export function estimateInputTokens(input: ModelInput): number {
  const { text, images } = projection(input)
  // Treat special-token-looking user text as ordinary text. Include schemas, message
  // framing and a 35% margin; compatible gateways can use different tokenizers
  // and add their own tool framing. Images retain a separate allowance.
  const tokens = textTokens(text)
  return Math.min(100_000_000, Math.ceil(tokens * 1.35) + 1024 + images * 16_384)
}

/** Strict financial admission bound, deliberately separate from context compression. */
export function estimateAdmissionTokens(input: ModelInput): number {
  const { text, images } = projection(input)
  return Math.min(100_000_000, Buffer.byteLength(text, 'utf8') + images * 16_384 + 4096)
}
