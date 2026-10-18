import { ApiError } from '@t-box/server-foundation/errors'
import { ErrorCode } from '../error-codes.js'

export function bad(message: string): never {
  throw ErrorCode.INVALID_CONFIG(message)
}
export function body(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    bad('请求必须是对象')
  }
  const result = value as Record<string, unknown>
  if (Object.keys(result).some((k) => !keys.includes(k))) {
    bad('请求包含未支持字段')
  }
  return result
}
export function text(value: unknown, label: string, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    bad(`${label}不能为空，最多 ${max} 字符`)
  }
  return value.trim()
}
export { password } from '@t-box/server-foundation/auth'
export function enabled(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    bad('启用状态无效')
  }
  return value
}
export function baseUrl(value: unknown) {
  const raw = text(value, 'API 地址', 500)
  try {
    const url = new URL(raw)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      bad('API 地址仅支持无账号、查询参数和锚点的 HTTP(S) 地址')
    }
    if (
      url.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ) {
      bad('非本机服务商必须使用 HTTPS')
    }
    return url.href.replace(/\/+$/, '')
  } catch (e) {
    if (e instanceof ApiError) {
      throw e
    }
    return bad('API 地址无效')
  }
}
