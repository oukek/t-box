import { ApiError } from '@t-box/server-foundation/errors'

export { ApiError, invalid } from '@t-box/server-foundation/errors'
export function notFound(): never {
  throw new ApiError(404, 'BILL_NOT_FOUND', '这条账单不存在或已被删除')
}
