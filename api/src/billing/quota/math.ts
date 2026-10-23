import type { QuotaTariff, QuotaUsageBudget } from '@t-box/shared'
import { ErrorCode } from '../../error-codes.js'
import { count } from '../money.js'

export const QUOTA_ATOMS = 10000n
export function quota(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,9}(?:\.\d{1,4})?$/.test(value)) {
    throw ErrorCode.QUOTA_INVALID()
  }
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole!) * QUOTA_ATOMS + BigInt(fraction.padEnd(4, '0'))
}
export function quotaText(value: bigint): string {
  const sign = value < 0n ? '-' : ''
  const n = value < 0n ? -value : value
  return `${sign}${n / QUOTA_ATOMS}.${(n % QUOTA_ATOMS).toString().padStart(4, '0')}`
}
export function quotaFee(
  tariff: QuotaTariff,
  usage: QuotaUsageBudget & { cachedInputTokens?: number | null },
): bigint {
  if (usage.images !== undefined) {
    return (
      quota(
        (usage.editing ? tariff.edits : tariff.images)[usage.tier ?? '1k'],
      ) * BigInt(count(usage.images))
    )
  }
  const input = count(usage.inputTokens ?? 0)
  const cached = count(usage.cachedInputTokens ?? 0)
  if (cached > input) {
    throw ErrorCode.USAGE_INVALID()
  }
  const numerator =
    BigInt(input - cached) * quota(tariff.inputPerMillion) +
    BigInt(cached) * quota(tariff.cachedInputPerMillion) +
    BigInt(count(usage.outputTokens ?? 0)) * quota(tariff.outputPerMillion)
  return (numerator + 999999n) / 1000000n
}
