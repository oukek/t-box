import { dayjs } from '@t-box/dayjs'

export type DateMode = 'date' | 'month' | 'year' | 'quarter'
export function calendarDate(year: number, month: number, day = 1) {
  return dayjs
    .utc(`${String(year).padStart(4, '0')}-01-01T12:00:00`)
    .month(month - 1)
    .date(day)
    .toDate()
}
export function dateKey(date: Date) {
  return dayjs.utc(date).format('YYYY-MM-DD')
}
export function daysInMonth(year: number, month: number) {
  return dayjs.utc(calendarDate(year, month)).daysInMonth()
}
export function calendarCells(
  year: number,
  month: number,
  weekStartsOn: 0 | 1 = 0,
) {
  const first = dayjs.utc(calendarDate(year, month))
  const offset = (first.day() - weekStartsOn + 7) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const date = first.add(i - offset, 'day')
    return {
      key: date.format('YYYY-MM-DD'),
      day: date.date(),
      inMonth: date.month() + 1 === month,
    }
  })
}

export function periodBounds(value: string, mode: DateMode): [string, string] {
  if (mode === 'date') {
    return [value, value]
  }
  const year = Number(value.slice(0, 4))
  if (mode === 'year') {
    return [`${value}-01-01`, `${value}-12-31`]
  }
  const month =
    mode === 'quarter'
      ? (Number(value.slice(-1)) - 1) * 3 + 1
      : Number(value.slice(5, 7))
  const end = mode === 'quarter' ? month + 2 : month
  return [
    dateKey(calendarDate(year, month)),
    dateKey(calendarDate(year, end, daysInMonth(year, end))),
  ]
}
export function periodAvailable(
  value: string,
  mode: DateMode,
  min: string,
  max: string,
) {
  const [start, end] = periodBounds(value, mode)
  return start <= max && end >= min
}

export function localDate(date = new Date()): string {
  return dayjs(date).format('YYYY-MM-DD')
}
