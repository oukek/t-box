import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertDisposableDatabase } from './fixtures.js'

test('integration database guard accepts the quality workflow schemas and named disposable schemas', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/quality.yml', import.meta.url), 'utf8')
  const schemas = [...workflow.matchAll(/^\s+MYSQL_DATABASE:\s*([a-z0-9_]+)\s*$/gm)].map((match) => match[1])
  assert.ok(schemas.length > 0, 'quality workflow must explicitly select a test database')
  for (const schema of [...schemas, 't_box_ci', 't_box_test_baby_diary', 't_box_test_other_123']) {
    assert.doesNotThrow(() => assertDisposableDatabase(schema))
  }
})

test('integration database guard rejects implicit, production and malformed schemas', () => {
  for (const schema of [undefined, null, {}, '', 't_box', 'production', 't_box_test_', 't_box_ci_copy', 't_box_ci\n', 't_box_test_a;drop', 't_box_test_../production']) {
    assert.throws(() => assertDisposableDatabase(schema), /disposable/)
  }
})
