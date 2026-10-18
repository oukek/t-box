import type { ToolResult } from '@t-box/shared'
import { ErrorCode } from '../error-codes.js'
import { object } from './schema.js'

export function parseToolResult(
  value: unknown,
  source: 'client' | 'journal' = 'client',
): ToolResult {
  const result = object(value, ['ok', 'data', 'error'])
  if (result.ok === true) {
    return { ok: true, data: result.data }
  }
  if (result.ok !== false) {
    throw ErrorCode.INVALID_TOOL_RESULT()
  }
  const error = object(result.error, ['code', 'message'])
  if (
    typeof error.code !== 'string' ||
    error.code.length > 80 ||
    typeof error.message !== 'string' ||
    (source === 'client' && error.message.length > 200)
  ) {
    throw ErrorCode.INVALID_TOOL_RESULT('工具错误回执格式不正确')
  }
  return {
    ok: false,
    error: { code: error.code, message: error.message },
  }
}
