import { ErrorCode } from './error-codes.js'

export { ApiError } from '@t-box/errors'

export function invalid(field: string, message: string): never {
  throw ErrorCode.VALIDATION_ERROR(undefined, {
    [field]: message,
  })
}
