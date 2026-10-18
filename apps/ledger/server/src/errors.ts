import { ErrorCode } from './error-codes.js'

export { ApiError, invalid } from '@t-box/server-foundation/errors'
export function notFound(): never {
  throw ErrorCode.BILL_NOT_FOUND()
}
