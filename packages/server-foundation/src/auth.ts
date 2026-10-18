import { ErrorCode } from './error-codes.js'

export function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 6 || value.length > 128) {
    throw ErrorCode.INVALID_CONFIG()
  }
  return value
}
export function bearer(value: unknown): string {
  return typeof value === 'string' && value.startsWith('Bearer ')
    ? value.slice(7)
    : ''
}
