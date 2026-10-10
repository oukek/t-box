import { dayjs, validDate } from '@t-box/time-contracts'

export const calendarWeekdays = [
  { value: 7, label: '日' },
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
] as const
export function calendarWeekStart(date: string): string {
  const d = dayjs.utc(validDate(date))
  return d.subtract(d.day(), 'day').format('YYYY-MM-DD')
}
/** Query bounds exclude padding outside the supported event range; the UI still displays seven weekday columns. */
export function calendarWeekRange(date: string): { from: string, to: string } {
  const start = calendarWeekStart(date)
  const end = dayjs.utc(start).add(6, 'day').format('YYYY-MM-DD')
  return {
    from: start < '1900-01-01' ? '1900-01-01' : start,
    to: end.length !== 10 || end > '9999-12-31' ? '9999-12-31' : end,
  }
}
