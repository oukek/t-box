import { ApiError } from './errors.js'

export function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 6 || value.length > 128) {
    throw new ApiError(400, 'INVALID_CONFIG', '密码长度需为 6–128 个字符')
  }
  return value
}
export function bearer(value: unknown): string {
  return typeof value === 'string' && value.startsWith('Bearer ')
    ? value.slice(7)
    : ''
}
