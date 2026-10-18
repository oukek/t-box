import assert from 'node:assert/strict'
import test from 'node:test'
import { parseToolResult } from '../src/agent/tool-result-schema.js'
import { auditCheckpoint } from '../src/operations/audit-checkpoint.js'
import { jsonValue } from '../src/operations/queries.js'

test('tool results are checked at transport and persisted journal boundaries', () => {
  assert.deepEqual(parseToolResult({ ok: true, data: { id: 'record' } }), {
    ok: true,
    data: { id: 'record' },
  })
  assert.deepEqual(
    parseToolResult({ ok: false, error: { code: 'DENIED', message: '拒绝' } }),
    { ok: false, error: { code: 'DENIED', message: '拒绝' } },
  )
  const longError = {
    ok: false,
    error: { code: 'VALIDATION_ERROR', message: 'x'.repeat(500) },
  }
  assert.throws(() => parseToolResult(longError))
  assert.deepEqual(
    parseToolResult(longError, 'journal'),
    longError,
    'persisted backend errors retain their original valid message',
  )
  for (const value of [
    null,
    [],
    { ok: 'true' },
    { ok: false, error: { code: 1, message: '失败' } },
    { ok: true, secret: 'unexpected' },
  ]) {
    assert.throws(() => parseToolResult(value))
  }
})
test('audit checkpoint decoding tolerates malformed data and selects only display fields', () => {
  for (const value of ['{', null, [], { session: { messages: 'invalid' } }]) {
    assert.deepEqual(auditCheckpoint(value).messages, [])
  }
  const value = auditCheckpoint(
    JSON.stringify({
      assistantId: 'a',
      recovery_auth_hash: 'private',
      session: {
        token: 'private',
        messages: [
          null,
          { id: 'u', role: 'user', content: '提问', password: 'private' },
          {
            id: 'a',
            role: 'assistant',
            content: '回答',
            attachments: [
              null,
              {
                id: 'r',
                name: 'file',
                mimeType: 'image/png',
                credential: 'private',
              },
            ],
          },
        ],
      },
    }),
  )
  assert.equal(value.assistantId, 'a')
  assert.equal(value.messages.length, 2)
  assert.deepEqual(value.messages[1]?.attachments, [
    { id: 'r', name: 'file', mimeType: 'image/png' },
  ])
  assert.equal(JSON.stringify(value).includes('private'), false)
  assert.equal(jsonValue('invalid'), null)
})
