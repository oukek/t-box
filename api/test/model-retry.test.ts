import type { ModelRequestRecord, RetryProgress } from '../src/agent/model-retry.js'
import type { ProviderInput } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '@t-box/server-foundation/errors'
import OpenAI from 'openai'
import {
  modelRequest,
  retryableModelError,
} from '../src/agent/model-retry.js'
import { publicRunError } from '../src/chat/errors.js'
import { providerStream } from '../src/chat/provider-stream.js'
import { ErrorCode } from '../src/error-codes.js'

const input = (signal = new AbortController().signal): ProviderInput => ({
  history: [{ role: 'user', content: 'test' }],
  tools: [],
  instructions: 'test',
  localDate: '2026-10-09',
  signal,
  onDelta() {},
  execution: { userId: 'user', operationId: 'old', purpose: 'response' },
})
const upstream = () =>
  new OpenAI.APIError(
    undefined,
    { type: 'upstream_error', message: 'private provider body' },
    undefined,
    new Headers({ 'x-request-id': 'req-safe' }),
  )
const fixture = () => {
  let now = 1000
  const records: Record<string, ModelRequestRecord> = {}
  const progress: RetryProgress[] = []
  const usageIds: string[] = []
  let persisted: typeof records = {}
  return {
    records,
    progress,
    usageIds,
    persisted: () => persisted,
    options: {
      records,
      now: () => now,
      random: () => 0,
      wait: async (ms: number) => {
        now += ms
      },
      save: async () => {
        persisted = structuredClone(records)
      },
      onRetry: async (p: RetryProgress) => {
        progress.push(p)
      },
      onUsage: async (_: unknown, id: string) => {
        usageIds.push(id)
      },
    },
  }
}
test('SDK SSE upstream errors without HTTP status have a safe provider classification', () => {
  const error = upstream()
  assert.equal(error.name, 'Error')
  assert.equal(publicRunError(error).code, 'PROVIDER_UPSTREAM_FAILED')
  assert.equal(retryableModelError(error), true)
  assert.ok(!JSON.stringify(publicRunError(error)).includes('private'))
  assert.equal(
    publicRunError(new OpenAI.APIConnectionTimeoutError({})).code,
    'PROVIDER_TIMEOUT',
  )
})
test('model retry succeeds with exact history, independent attempt metering and Retry-After', async () => {
  const f = fixture()
  const ids: string[] = []
  let calls = 0
  const result = await modelRequest(
    'next',
    input(),
    async (request) => {
      calls++
      ids.push(request.execution!.operationId)
      assert.deepEqual(request.history, input().history)
      if (calls === 1) {
        throw new OpenAI.APIError(
          429,
          { type: 'rate_limit_error' },
          undefined,
          new Headers({ 'retry-after': '4' }),
        )
      }
      await request.onUsage!({
        inputTokens: 1,
        outputTokens: 2,
        responseId: 'reply',
      })
      return { answer: '3' }
    },
    f.options,
  )
  assert.deepEqual(result, { answer: '3' })
  assert.equal(calls, 2)
  assert.equal(new Set(ids).size, 2)
  assert.deepEqual(f.usageIds, [ids[1]])
  assert.equal(f.progress[0]!.delayMs, 4000)
  const restore = fixture()
  restore.options.records = f.persisted()
  const cached = await modelRequest(
    'next',
    input(),
    async () => {
      throw new Error('must not reissue a saved response')
    },
    restore.options,
  )
  assert.deepEqual(cached, result)
})
test('automatic attempts are exactly initial + five retries, including restored counters', async () => {
  const f = fixture()
  let calls = 0
  await assert.rejects(
    modelRequest(
      'next',
      input(),
      async () => {
        calls++
        throw upstream()
      },
      f.options,
    ),
    { code: 'MODEL_RETRIES_EXHAUSTED' },
  )
  assert.equal(calls, 6)
  assert.deepEqual(
    f.progress.map((p) => p.attempt),
    [1, 2, 3, 4, 5],
  )
  const restore = fixture()
  restore.options.records = f.persisted()
  let recovered = 0
  // A persisted in-flight final attempt consumes no fresh retry allowance.
  await assert.rejects(
    modelRequest(
      'next',
      input(),
      async () => {
        recovered++
        throw upstream()
      },
      restore.options,
    ),
    { code: 'MODEL_RETRIES_EXHAUSTED' },
  )
  assert.equal(recovered, 0)
})
test('malformed provider completions retry the current request, then stop after five retries', async () => {
  const f = fixture()
  let calls = 0
  const original = input()
  await assert.rejects(modelRequest('next', original, async (request) => {
    calls++
    assert.deepEqual(request.history, original.history)
    throw ErrorCode.PROVIDER_FAILED()
  }, f.options), { code: 'MODEL_RETRIES_EXHAUSTED', message: /已自动重试 5 次/ })
  assert.equal(calls, 6)
  assert.deepEqual(f.progress.map((p) => p.attempt), [1, 2, 3, 4, 5])
  assert.ok(f.progress.every((p) => p.error.code === 'PROVIDER_FAILED'))
})
test('parameter/auth/quota/host/billing/unknown errors are never automatically retried', async () => {
  for (const error of [
    new OpenAI.APIError(
      400,
      { code: 'unsupported_parameter' },
      undefined,
      undefined,
    ),
    new OpenAI.APIError(401, {}, undefined, undefined),
    new OpenAI.APIError(
      429,
      { code: 'insufficient_quota' },
      undefined,
      undefined,
    ),
    new ApiError(502, 'USAGE_MISSING', 'fee review'),
    new ApiError(502, 'PROVIDER_INCOMPLETE', 'token limit'),
    new Error('bug'),
  ]) {
    const f = fixture()
    let calls = 0
    await assert.rejects(
      modelRequest(
        'next',
        input(),
        async () => {
          calls++
          throw error
        },
        f.options,
      ),
      (e) => e === error,
    )
    assert.equal(calls, 1)
    assert.equal(f.progress.length, 0)
  }
})
test('canceling a delayed retry never starts another request', async () => {
  const f = fixture()
  const abort = new AbortController()
  let calls = 0
  f.options.wait = async () => {
    abort.abort('CANCELLED')
  }
  await assert.rejects(
    modelRequest(
      'next',
      input(abort.signal),
      async () => {
        calls++
        throw upstream()
      },
      f.options,
    ),
  )
  assert.equal(calls, 1)
})
test('usage/storage callback errors do not replay a provider request', async () => {
  const f = fixture()
  let calls = 0
  f.options.onUsage = async () => {
    throw upstream()
  }
  await assert.rejects(
    modelRequest(
      'next',
      input(),
      async (request) => {
        calls++
        await request.onUsage!({
          inputTokens: 1,
          outputTokens: 1,
          responseId: 'r',
        })
        return 'done'
      },
      f.options,
    ),
  )
  assert.equal(calls, 1)
  assert.equal(f.progress.length, 0)
  const g = fixture()
  let saves = 0
  g.options.save = async () => {
    if (++saves === 2) {
      throw new Error('storage failed')
    }
  }
  await assert.rejects(
    modelRequest(
      'next',
      input(),
      async () => {
        calls++
        return 'saved in memory'
      },
      g.options,
    ),
  )
  assert.equal(calls, 2)
  assert.equal(g.progress.length, 0)
})
test('stream transport normalization never treats application callback errors as provider failures', async () => {
  const stream = {
    async* [Symbol.asyncIterator]() {
      yield 'partial'
      throw new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } })
    },
  }
  await assert.rejects(
    async () => {
      for await (const item of providerStream(stream)) {
        assert.equal(item, 'partial')
      }
    },
    (error) => error instanceof OpenAI.APIConnectionError,
  )
  const callbackError = new Error('local callback')
  await assert.rejects(
    async () => {
      // eslint-disable-next-line no-unreachable-loop -- Intentionally simulate a consumer throwing on its first streamed value.
      for await (const _ of providerStream({
        async* [Symbol.asyncIterator]() {
          yield 'text'
        },
      })) {
        throw callbackError
      }
    },
    (error) => error === callbackError,
  )
})
