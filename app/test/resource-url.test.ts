import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resourceUrl } from '../src/core/resource-url.js'

const access = { origin: 'https://tboxos.oss-cn-hangzhou.aliyuncs.com', path: 'uploads/resources/00000000-0000-4000-8000-000000000001' }
test('resource downloads assemble the standard OSS domain and relative key at read time', () => {
  const url = new URL(resourceUrl(access.origin, access.path))
  assert.equal(url.origin, access.origin)
  assert.equal(url.pathname, `/${access.path}`)
  assert.equal(url.search, '')
  assert.equal(url.hash, '')
  const opaque = 'uploads/resources/' + 'a'.repeat(64)
  assert.equal(new URL(resourceUrl(access.origin, opaque)).pathname, '/' + opaque)
})
test('public resource URLs reject non-OSS domains, path escapes and embedded signatures', () => {
  for (const invalid of [
    { origin: 'https://cdn.example.com' },
    { path: '../index.html' },
    { path: '//other.example.com/image.png' },
    { origin: 'https://tboxos.oss-cn-hangzhou.aliyuncs.com?token=secret' },
    { path: access.path + '?x-oss-signature=secret' },
    { path: access.path + '#fragment' },
    { path: 'uploads/resources/application-files/' + 'a'.repeat(64) },
    { path: 'uploads/resources/' + 'a'.repeat(63) },
  ]) {
    const value = { ...access, ...invalid }
    assert.throws(() => resourceUrl(value.origin, value.path))
  }
})
