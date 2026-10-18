import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError, apiErrorResponse, defineApiErrors, defineInternalErrors } from '@t-box/errors'
import { ErrorCode } from '../src/error-codes.js'

test('error factories preserve public status/code, field details and independently captured instances', () => {
  const defaults = ErrorCode.MODEL_NOT_FOUND()
  assert.ok(defaults instanceof ApiError)
  assert.equal(defaults.statusCode, 404)
  assert.equal(defaults.code, 'MODEL_NOT_FOUND')
  assert.equal(defaults.message, '模型配置不存在')
  const dynamic = ErrorCode.MODEL_NOT_FOUND('模型配置已被管理员移除')
  assert.notEqual(defaults, dynamic)
  assert.equal(dynamic.message, '模型配置已被管理员移除')
  const validation = defineApiErrors({ FIXTURE_VALIDATION: { statusCode: 400, message: '检查内容' } })
  assert.deepEqual(validation.FIXTURE_VALIDATION(undefined, { nickname: '至少 2 个字符' }).details, { nickname: '至少 2 个字符' })
  assert.ok(Object.isFrozen(ErrorCode))
})

test('intentional HTTP variants reuse one registered wire code and cannot change the default', () => {
  const normal = ErrorCode.APP_NOT_INSTALLED()
  const conflict = ErrorCode.APP_NOT_INSTALLED.conflict()
  assert.equal(normal.statusCode, 403)
  assert.equal(conflict.statusCode, 409)
  assert.equal(normal.code, conflict.code)
  assert.equal(ErrorCode.APP_NOT_INSTALLED().statusCode, 403)
})

test('internal errors retain causes and never become public ApiError instances', () => {
  const internal = defineInternalErrors('FIXTURE', { CONNECTION_FAILED: '无法连接' })
  const cause = new Error('private driver details')
  const error = internal.CONNECTION_FAILED(undefined, { cause })
  assert.equal(error.code, 'FIXTURE_CONNECTION_FAILED')
  assert.equal(error.cause, cause)
  assert.equal(error instanceof ApiError, false)
})

test('public serialization only contains the documented error fields', () => {
  const error = ErrorCode.VALIDATION_ERROR('请检查输入', { nickname: '不能为空' })
  Object.assign(error, { cause: new Error('private driver details') })
  assert.deepEqual(apiErrorResponse(error), { error: { code: 'VALIDATION_ERROR', message: '请检查输入', details: { nickname: '不能为空' } } })
})
