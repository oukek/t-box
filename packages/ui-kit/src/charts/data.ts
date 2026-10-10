import { fromCents, toCents } from '../decimal'

type StatisticPeriod = 'day' | 'month' | 'quarter' | 'year'
interface StatisticPoint {
  date: string
  income: string
  expense: string
  cashIn: string
  cashOut: string
}
export interface TrendPoint {
  start: string
  end: string
  label: string
  income: string
  expense: string
}
/** Preserve empty dates; only chart geometry uses floating point numbers. */
export function trendPoints(
  series: readonly StatisticPoint[],
  period: StatisticPeriod,
  metric: 'ordinary' | 'cash' = 'ordinary',
): TrendPoint[] {
  const groups = new Map<
    string,
    {
      start: string
      end: string
      label: string
      income: bigint
      expense: bigint
    }
  >()
  series.forEach((row, index) => {
    const key =
      period === 'year'
        ? row.date.slice(0, 7)
        : period === 'quarter'
          ? String(Math.floor(index / 7))
          : row.date
    const group = groups.get(key) || {
      start: row.date,
      end: row.date,
      label:
        period === 'year'
          ? `${Number(row.date.slice(5, 7))}月`
          : row.date.slice(5).replace('-', '/'),
      income: 0n,
      expense: 0n,
    }
    group.end = row.date
    group.income += toCents(metric === 'cash' ? row.cashIn : row.income)
    group.expense += toCents(metric === 'cash' ? row.cashOut : row.expense)
    groups.set(key, group)
  })
  return [...groups.values()].map((row) => ({
    ...row,
    income: fromCents(row.income),
    expense: fromCents(row.expense),
  }))
}
export interface CategorySlice {
  label: string
  amount: string
  count: number
  color: string
  percentage: number
}
const colors = [
  '#137b72',
  '#cf805f',
  '#8a8cb8',
  '#8eab8f',
  '#c6ac68',
  '#7295b0',
  '#b0bec2',
]
export function categorySlices(
  rows: readonly { label: string, amount: string, count: number }[],
): CategorySlice[] {
  const positive = rows
    .filter((row) => toCents(row.amount) > 0n)
    .sort((a, b) =>
      toCents(a.amount) > toCents(b.amount)
        ? -1
        : toCents(a.amount) < toCents(b.amount)
          ? 1
          : 0,
    )
  const total = positive.reduce((sum, row) => sum + toCents(row.amount), 0n)
  if (!total) {
    return []
  }
  const groups = positive.slice(0, 6)
  if (positive.length > 6) {
    const tail = positive.slice(6)
    groups.push({
      label: `其他 ${tail.length} 类`,
      amount: fromCents(
        tail.reduce((sum, row) => sum + toCents(row.amount), 0n),
      ),
      count: tail.reduce((sum, row) => sum + row.count, 0),
    })
  }
  return groups.map((row, index) => ({
    ...row,
    color: colors[index]!,
    percentage: (Number(toCents(row.amount)) / Number(total)) * 100,
  }))
}
