import { invalid } from '@t-box/server-foundation/errors'
/** Decimal strings throughout; bigint arithmetic never crosses the JSON boundary. */
export function cents(value: string): bigint {
  const negative = value.startsWith('-')
  const [whole, decimal = ''] = value.replace(/^-/, '').split('.')
  const result = BigInt(whole!) * 100n + BigInt(decimal.padEnd(2, '0'))
  return negative ? -result : result
}
export function money(value: bigint): string {
  const absolute = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`
}
export function amount(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value) ||
    cents(value) <= 0n
  ) {
    invalid('amount', '金额须大于零，最多两位小数，最大 999999999.99')
  }
  return money(cents(value))
}
