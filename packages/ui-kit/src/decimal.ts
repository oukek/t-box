export function toCents(value: string): bigint {
  const negative = value.startsWith('-')
  const [whole, decimal = ''] = value.replace(/^-/, '').split('.')
  const total = BigInt(whole!) * 100n + BigInt(decimal.padEnd(2, '0'))
  return negative ? -total : total
}
export function fromCents(value: bigint): string {
  const absolute = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`
}
export function formatMoney(value: string): string {
  const [integer = '0', decimal = '00'] = value.split('.')
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decimal.padEnd(2, '0')}`
}
