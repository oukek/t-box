import { invalid } from '@t-box/server-foundation/errors'

export { definition, nullable, object } from '../application-sdk/schema.js'
export type { Schema } from '../application-sdk/schema.js'
export { parseDate } from '@t-box/server-foundation/validation'
export function parseIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) {
    invalid('id', '标识格式不正确')
  }
  return value
}
