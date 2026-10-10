import { invalid } from '@t-box/server-foundation/errors'

export { definition, nullable, object } from '../application-sdk/schema.js'
export type { Schema } from '../application-sdk/schema.js'
export function parseDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)
  ) {
    invalid('localDate', '日期格式应为 YYYY-MM-DD')
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    invalid('localDate', '请输入真实存在的日期')
  }
  return value
}
export function parseIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) {
    invalid('id', '标识格式不正确')
  }
  return value
}
