import type { ModelPrices } from '@t-box/shared'
import { ApiError } from '@t-box/server-foundation/errors'

const SCALE = 1_000_000n
/** All arithmetic uses integer micro-yuan. Never convert balances through Number. */
export function money(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,7}(?:\.\d{1,6})?$/.test(value)) {
    throw new ApiError(
      400,
      'INVALID_PRICE',
      '金额须为非负十进制字符串，最多 6 位小数',
    )
  }
  const [whole, fraction = ''] = value.split('.')
  const result = BigInt(whole!) * SCALE + BigInt(fraction.padEnd(6, '0'))
  if (result > 1_000_000n * SCALE) {
    throw new ApiError(400, 'INVALID_PRICE', '金额不能超过 100 万元')
  }
  return result
}
export function decimal(value: bigint): string {
  const negative = value < 0n
  const n = negative ? -value : value
  return `${negative ? '-' : ''}${n / SCALE}.${(n % SCALE).toString().padStart(6, '0')}`
}
export function count(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > 100_000_000
  ) {
    throw new ApiError(
      502,
      'USAGE_INVALID',
      '服务商返回的用量无效，费用待核对',
    )
  }
  return Number(value)
}
export function tokenFee(prices: ModelPrices, input: number, output: number) {
  const numerator =
    money(prices.inputPrice) * BigInt(count(input)) +
    money(prices.outputPrice) * BigInt(count(output))
  return (numerator + SCALE - 1n) / SCALE
}
export function prices(value: Partial<ModelPrices>): ModelPrices {
  return {
    inputPrice: decimal(money(value.inputPrice ?? '0')),
    outputPrice: decimal(money(value.outputPrice ?? '0')),
    imagePrice: decimal(money(value.imagePrice ?? '0')),
  }
}
