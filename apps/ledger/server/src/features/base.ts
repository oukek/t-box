import type { FinanceService } from '../finance/service.js'
import type { Access, Principal } from '../ledgers/types.js'
import { ApiError, invalid } from '@t-box/server-foundation/errors'
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
      throw new ApiError(403, 'FORBIDDEN', '仅账本所有者或管理员可管理此设置')
    }
  }
}
export const json = <T>(value: T | string): T =>
  typeof value === 'string' ? JSON.parse(value) : value
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
  throw new ApiError(404, 'RECORD_NOT_FOUND', '记录不存在或不可访问')
}
