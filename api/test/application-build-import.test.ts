import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bundleHash, bundleLimit, downloadBundle, importLocation } from '../src/application-platform/build-import.js'

const origin = 'https://test-bucket.oss-cn-hangzhou.aliyuncs.com'
const digest = 'a'.repeat(64)
const path = '/t-box/apps/calculator/1.0.1/' + digest + '.json'
test('OSS import pins the exact bucket, directory, app, version and hash', () => {
  assert.equal(importLocation(origin + path + '?signature=secret', 'calculator', '1.0.1', digest, origin, 't-box/apps').pathname, path)
  for (const url of [
    'https://127.0.0.1' + path,
    'https://evil.example.com' + path,
    origin + path + '/extra',
    origin + path.replace('calculator', 'ledger'),
    origin + path.replace('1.0.1', '1.0.2'),
    origin + path + '#fragment',
    'https://user:pass@test-bucket.oss-cn-hangzhou.aliyuncs.com' + path,
  ]) {
    assert.throws(() => importLocation(url, 'calculator', '1.0.1', digest, origin, 't-box/apps'))
  }
  assert.throws(() => importLocation(origin + path, 'calculator', '1.0.1', digest, 'https://evil.example.com', 't-box/apps'))
})

test('bounded download verifies SHA256 and disables redirects', async () => {
  const bytes = Buffer.from('{"protocol":1}')
  const mock = (async (_url, options) => {
    assert.equal(options?.redirect, 'error')
    assert.ok(options?.signal)
    return new Response(bytes)
  }) as typeof fetch
  assert.deepEqual(await downloadBundle(new URL(origin), bundleHash(bytes), mock), { protocol: 1 })
  await assert.rejects(downloadBundle(new URL(origin), digest, mock), /SHA-256/)
  const oversized = (async () => new Response(Buffer.alloc(bundleLimit + 1))) as typeof fetch
  await assert.rejects(downloadBundle(new URL(origin), digest, oversized), /30 MB/)
  const invalid = Buffer.from('not-json')
  await assert.rejects(downloadBundle(new URL(origin), bundleHash(invalid), (async () => new Response(invalid)) as typeof fetch), /JSON/)
  await assert.rejects(downloadBundle(new URL(origin), digest, (async () => new Response('expired', { status: 403 })) as typeof fetch), /OSS/)
})
