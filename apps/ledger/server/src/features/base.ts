import type { FinanceService } from '../finance/service.js'
import type { Access, Principal } from '../ledgers/types.js'
import { invalid } from '@t-box/server-foundation/errors'
import { ErrorCode } from '../error-codes.js'
import { parseId } from '../validation.js'

export class FeatureService {
  constructor(readonly finance: FinanceService) {}
  get access() {
    return this.finance.access
  }

  get db() {
    return this.finance.operations.manager
  }

  async read(actor: Principal, book: string) {
    await this.access.check(actor, book)
  }

  manage(access: Access) {
    if (!['owner', 'admin'].includes(access.role)) {
      throw ErrorCode.FORBIDDEN()
    }
  }
}
export const json = <T>(value: unknown): T =>
  typeof value === 'string' ? JSON.parse(value) : (value as T)
export function integer(v: unknown, name: string, min: number, max: number) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    invalid(name, `请输入 ${min}–${max} 的整数`)
  }
  return v
}
export function optionalId(v: unknown): string | null {
  return v === null || v === undefined ? null : parseId(v)
}

export function notFound(): never {
  throw ErrorCode.RECORD_NOT_FOUND()
}
