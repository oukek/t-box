import assert from 'node:assert/strict'
import test from 'node:test'
import { assertDisposableDatabase } from './fixtures.js'

test('integration database guard accepts CI and named disposable schemas', () => {
  for (const schema of ['t_box_ci', 't_box_test_baby_diary', 't_box_test_other_123']) {
    assert.doesNotThrow(() => assertDisposableDatabase(schema))
  }
})

test('integration database guard rejects implicit, production and malformed schemas', () => {
  for (const schema of [undefined, null, {}, '', 't_box', 'production', 't_box_test_', 't_box_ci_copy', 't_box_ci\n', 't_box_test_a;drop', 't_box_test_../production']) {
    assert.throws(() => assertDisposableDatabase(schema), /disposable/)
  }
})
