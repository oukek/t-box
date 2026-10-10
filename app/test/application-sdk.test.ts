import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateApplicationRestPath } from '../src/core/app-runtime/trustedPath'

test('trusted REST adapter accepts exact application roots, children and encoded queries', () => {
  for (const path of [
    '/ledgers',
    '/ledgers/book-id/bills',
    '/ledgers?search=hello%20world',
    '/ledgers/book-id/bills?search=../notes',
  ]) {
    assert.doesNotThrow(() => validateApplicationRestPath(['/ledgers'], path))
  }
})
test('trusted REST adapter refuses other app paths, sibling prefixes and absolute URLs', () => {
  for (const path of [
    '/calendar/events',
    '/auth/me',
    '/ledgers-other',
    '//external.example/ledgers',
    'https://external.example/ledgers',
  ]) {
    assert.throws(
      () => validateApplicationRestPath(['/ledgers'], path),
      (e) => (e as { code: string }).code === 'API_SCOPE_DENIED',
    )
  }
})
test('trusted REST adapter blocks literal, encoded and double-encoded traversal', () => {
  for (const path of [
    '/ledgers/../auth/me',
    '/ledgers/./books',
    '/ledgers/%2e%2e/auth/me',
    '/ledgers/a%2f..%2f..%2fauth/me',
    '/ledgers/%252e%252e/auth/me',
    '/ledgers/\\..\\auth/me',
    '/ledgers//books',
    '/ledgers/a#../auth',
    '/ledgers/%00bad',
    '/ledgers/%zz',
  ]) {
    assert.throws(
      () => validateApplicationRestPath(['/ledgers'], path),
      (e) => (e as { code: string }).code === 'INVALID_API_PATH',
      path,
    )
  }
})
