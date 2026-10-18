import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectBusinessSource } from './check-business-code.mjs'

test('business guard rejects scattered constructors but accepts typed factories and response adapters', () => {
  assert.match(inspectBusinessSource('api/src/example.ts', 'throw new ApiError(404,\'TYPO\',\'失败\')').issues.join(), /typed error factory/)
  assert.match(inspectBusinessSource('apps/notes/web/src/main.ts', 'throw new Error(\'失败\')').issues.join(), /typed error factory/)
  assert.deepEqual(inspectBusinessSource('api/src/example.ts', 'throw ErrorCode.NOT_FOUND()').issues, [])
  assert.deepEqual(inspectBusinessSource('api/src/error-codes.ts', 'const make = () => new ApiError(404,\'TEST\',\'失败\')').issues, [])
  assert.deepEqual(inspectBusinessSource('sdk/src/http.ts', 'class RequestError extends Error { static fromResponse() { return new RequestError() } }').issues, [])
})

test('catalog guard extracts stable code ownership and validates HTTP states', () => {
  const result = inspectBusinessSource('api/src/error-codes.ts', 'defineApiErrors({ TEST_FAILURE: {statusCode:400,message:\'失败\'} })')
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.definitions, [{ code: 'TEST_FAILURE', path: 'api/src/error-codes.ts' }])
  assert.match(inspectBusinessSource('api/src/error-codes.ts', 'defineApiErrors({ bad: {statusCode:200,message:\'失败\'} })').issues.join(), /uppercase|HTTP error status/)
})

test('ordinary CRUD cannot bypass ORM checks with an exception comment', () => {
  assert.match(inspectBusinessSource('api/src/example.ts', '// native-sql: convenient\nawait db.query(\'SELECT id FROM bills WHERE id=?\',[id])').issues.join(), /ordinary CRUD/)
  assert.deepEqual(inspectBusinessSource('api/src/example.ts', '// native-sql: independent aggregate preserves financial totals\nawait db.query(\'SELECT type,SUM(amount) FROM bills GROUP BY type\')').issues, [])
  assert.deepEqual(inspectBusinessSource('api/src/db/schema/ai.ts', 'await db.query(\'INSERT INTO ai_settings(id) VALUES(1)\')').issues, [])
})

test('raw row selections must keep explicit column aliases', () => {
  assert.match(inspectBusinessSource('api/src/example.ts', 'db.createQueryBuilder().select(\'u.id\').from(\'app_users\',\'u\').getRawMany()').issues.join(), /result alias/)
  assert.deepEqual(inspectBusinessSource('api/src/example.ts', 'db.createQueryBuilder().select(\'u.id\',\'id\').from(\'app_users\',\'u\').getRawMany()').issues, [])
})

test('guards inspect Vue scripts and both conditional SQL branches', () => {
  const vue = '<script setup lang="ts">\nthrow new Error(\'失败\')\n</script>\n<template><div /></template>'
  assert.match(inspectBusinessSource('app/src/Example.vue', vue).issues.join(), /Example.vue:2:.*typed error factory/)
  const sql = 'db.query(id ? \'SELECT * FROM users WHERE id=?\' : \'SELECT * FROM users\', [id])'
  assert.equal(inspectBusinessSource('api/src/example.ts', sql).issues.filter((issue) => issue.includes('ordinary CRUD')).length, 2)
})

test('internal catalogs also use stable namespaced codes that fit diagnostics', () => {
  const result = inspectBusinessSource('api/src/error-codes.ts', 'defineInternalErrors(\'API\', {CONNECTION_FAILED: \'失败\'})')
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.internalDefinitions, [{ code: 'API_CONNECTION_FAILED', path: 'api/src/error-codes.ts' }])
  assert.match(inspectBusinessSource('api/src/error-codes.ts', `defineInternalErrors('API', {${'LONG_'.repeat(20)}: '失败'})`).issues.join(), /80-character/)
})

test('queries cannot select whole rows implicitly, including conditional branches and arrays', () => {
  for (const projection of ['\'*\'', '\'r.*\'', '\'r.id,u.*\'', 'flag ? \'id\' : \'*\'', '[\'id\', \'u.*\']']) {
    assert.match(inspectBusinessSource('api/src/example.ts', `db.createQueryBuilder().select(${projection}).getRawMany()`).issues.join(), /explicit query fields/)
  }
  assert.deepEqual(inspectBusinessSource('api/src/example.ts', 'db.createQueryBuilder().select(\'COUNT(*) AS total,SUM(price*count) AS amount\').getRawMany()').issues, [])
})

test('complex native SQL cannot reintroduce wildcard row projections', () => {
  const sql = '// native-sql: union needs explicit compatible projections\n db.query(\'SELECT * FROM a UNION SELECT * FROM b\')'
  assert.match(inspectBusinessSource('api/src/example.ts', sql).issues.join(), /explicit query fields/)
})
