export const displayMoney = (value: string) =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
export function quotaPercentage(available: string, total: string): string {
  const atoms = (value: string) => {
    const [whole = '0', fraction = ''] = value.split('.')
    return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))
  }
  const full = atoms(total)
  const percent = full ? (atoms(available) * 10000n) / full : 0n
  return `${percent / 100n}.${String(percent % 100n).padStart(2, '0')}`
}
