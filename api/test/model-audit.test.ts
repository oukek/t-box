import assert from 'node:assert/strict'
import test from 'node:test'
import { auditPayload } from '../src/models/audit.js'
import { operationFilters } from '../src/operations/queries.js'

test('Model audits redact embedded tool credentials, binary data, signed URLs and provider echoes', () => {
  const raw = auditPayload({
    arguments: JSON.stringify({ resourceToken: 'resource-secret', password: 'book-secret', client_secret: 'client-secret', value: 12 }),
    api_key: 'other-key',
    file_data: 'large-file-payload',
    image_url: { url: 'https://private.example/image' },
    encrypted_content: 'opaque-model-memory',
    text: 'provider-key-123 Bearer session-secret data:image/png;base64,aGVsbG8= https://example.com/image?signature=signed-secret&token=url-secret',
    count: { inputTokens: 12, cached_tokens: 5 },
  }, ['provider-key-123'])
  for (const secret of ['resource-secret', 'book-secret', 'client-secret', 'other-key', 'large-file-payload', 'private.example', 'opaque-model-memory', 'provider-key-123', 'session-secret', 'aGVsbG8=', 'signed-secret', 'url-secret']) {
    assert.equal(raw.includes(secret), false, secret)
  }
  const parsed = JSON.parse(raw)
  assert.equal(parsed.arguments.value, 12)
  assert.equal(parsed.count.inputTokens, 12)
  assert.equal(parsed.count.cached_tokens, 5)
})
test('Audit payloads bound depth, cycles and aggregate size without throwing', () => {
  const cycle: any = { content: 'x'.repeat(10000) }
  cycle.self = cycle
  const encoded = auditPayload(cycle, [], 4096)
  assert.ok(encoded.length <= 6144)
  assert.ok(encoded.includes('truncated'))
  assert.doesNotThrow(() => JSON.parse(encoded))
  assert.ok(auditPayload({ cycle: (() => {
    const a: any = {}
    a.a = a
    return a
  })() }).includes('cycle'))
})
test('Administrative filters validate pagination, IDs and states, and parameterize literal search', () => {
  assert.throws(() => operationFilters({ page: '0' }, 'task'))
  assert.throws(() => operationFilters({ pageSize: '999' }, 'task'))
  assert.throws(() => operationFilters({ status: 'succeeded' }, 'task'))
  assert.throws(() => operationFilters({ modelId: 'bad-id' }, 'call'))
  const result = operationFilters({ search: 'x%_\' OR 1=1', page: '2' }, 'call')
  assert.equal(result.offset, 20)
  assert.equal(result.condition.includes('OR 1=1'), false)
  assert.equal(result.bindings.search, '%x!%!_\' OR 1=1%')
})
