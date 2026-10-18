import { dayjs } from '@t-box/dayjs'
import { ErrorCode } from '../error-codes.js'

export type JsonDocument = object | string | number | boolean | null

export function jsonDocument(value: unknown): JsonDocument {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      throw ErrorCode.INVALID_JSON_DOCUMENT()
    }
    return JSON.parse(serialized) as JsonDocument
  } catch (cause) {
    throw ErrorCode.INVALID_JSON_DOCUMENT(undefined, { cause })
  }
}

/** MySQL DATETIME is returned as a UTC Date; DATE-only columns remain strings. */
export function sqlClock(value: Date | string): string {
  return typeof value === 'string'
    ? value
    : dayjs.utc(value).format('YYYY-MM-DD HH:mm:ss.SSS')
}

export function utcDate(value: Date | string): Date {
  return typeof value === 'string' ? dayjs.utc(value).toDate() : value
}

export const utcSqlDateTime = {
  to(value: Date | string | null | undefined) {
    return typeof value === 'string' ? dayjs.utc(value).toDate() : value
  },
  from(value: Date | string | null) {
    return value === null ? null : sqlClock(value)
  },
}
