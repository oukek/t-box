/** Exact monetary arithmetic; Number is reserved for chart proportions. */
import { fromCents, toCents } from '@t-box/ui-kit/decimal'

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Keep currency as decimal strings from the form through the API. Conversion to
// Number is only used to render the optional category proportions.
export { formatMoney } from '@t-box/ui-kit/decimal'
export function normalizeAmount(value: string): string | null {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value)) {
    return null
  }
  const [integer, decimal = ''] = value.split('.')
  const amount = `${integer}.${decimal.padEnd(2, '0')}`
  return amount === '0.00' ? null : amount
}

export function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) {
    return value
  }
  const date = new Date(year, month - 1, day)
  return `${month} 月 ${day} 日 · ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]}`
}
export { fromCents, toCents } from '@t-box/ui-kit/decimal'
export function difference(end: string, start: string) {
  return fromCents(toCents(end) - toCents(start))
}
