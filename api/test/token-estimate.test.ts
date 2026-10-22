import type { ProviderInput } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareContext } from '../src/agent/context.js'
import { estimateAdmissionTokens, estimateInputTokens } from '../src/agent/token-estimate.js'

const input = (text: string): ProviderInput => ({
  history: [{ role: 'user', content: text }],
  instructions: '帮助用户',
  tools: [],
  localDate: '2026-10-22',
  signal: new AbortController().signal,
  onDelta() {},
})
test('context counts text tokens instead of UTF-8 bytes; billing admission remains conservative', async () => {
  const request = input('用户希望查询明天的日程安排。'.repeat(600))
  assert.ok(estimateAdmissionTokens(request) > 32768 * 0.75)
  assert.ok(estimateInputTokens(request) < 32768 * 0.75)
  const result = await prepareContext({
    mode: 'openai',
    contextPolicy: { maxInputTokens: 32768, compaction: true, compactionMode: 'summary', promptCacheKey: false },
    async next() {
      throw new Error('unused')
    },
    async summarize() {
      throw new Error('premature compression')
    },
  }, request)
  assert.equal(result.compacted, false)
})
test('schemas and literal special tokens are counted, server metadata and image base64 are excluded', () => {
  const request = input('literal <|endoftext|> <|im_start|>')
  assert.doesNotThrow(() => estimateInputTokens(request))
  const withMetadata = { ...request, privateSnapshot: 'private'.repeat(10000) }
  assert.equal(estimateInputTokens(request), estimateInputTokens(withMetadata))
  const withSchema = { ...request, tools: [{ type: 'function' as const, name: 'lookup', description: '查询数据'.repeat(400), parameters: { type: 'object' }, strict: false }] }
  assert.ok(estimateInputTokens(withSchema) > estimateInputTokens(request) + 500)
  const picture = (size: number): ProviderInput => ({ ...request, history: [{ role: 'user', content: [{ type: 'input_image', image_url: `data:image/png;base64,${'A'.repeat(size)}`, detail: 'auto' }] }] })
  assert.equal(estimateInputTokens(picture(100)), estimateInputTokens(picture(100000)))
  assert.ok(estimateInputTokens(picture(100)) >= 16384)
})
