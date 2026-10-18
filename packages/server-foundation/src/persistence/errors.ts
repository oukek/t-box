import { DateTimeError } from '@t-box/dayjs'
import { ErrorCode } from '../error-codes.js'

export function temporalDomain<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof DateTimeError) {
      throw ErrorCode.INVALID_DATETIME(error.message)
    }
    throw error
  }
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw ErrorCode.REVISION_REQUIRED()
  }
  return Number(value)
}
