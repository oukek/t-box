import type { HolidayArrangement, HolidayYearSnapshot } from './holidays.js'
import { dayjs, validDate } from '@t-box/time-contracts'
import { Solar } from 'lunar-typescript'
import {
  holidayArrangement,
  holidayScheduleKnown,
} from './holidays.js'

export interface CalendarDayInfo {
  date: string
  lunar: null | {
    year: number
    month: number
    day: number
    leapMonth: boolean
    monthName: string
    dayName: string
    label: string
    yearName: string
    zodiac: string
  }
  solarTerm: string | null
  nextSolarTerm: null | { name: string, date: string, daysAway: number }
  festivals: string[]
  arrangement: HolidayArrangement | null
  scheduleKnown: boolean
  label: string
  labelKind: 'lunar' | 'festival' | 'term'
}
const cache = new Map<string, CalendarDayInfo>()
/** Chinese almanac uses a civil date, independent of the device timezone. Supported display range: 1900–2100. */
function baseDayInfo(date: string): CalendarDayInfo {
  const cached = cache.get(date)
  if (cached) {
    return structuredClone(cached)
  }
  // Month grids may contain padding cells outside the event date range.
  if (date < '1900-01-01' || date > '2100-12-31') {
    return {
      date,
      lunar: null,
      solarTerm: null,
      nextSolarTerm: null,
      festivals: [],
      arrangement: null,
      scheduleKnown: false,
      label: '',
      labelKind: 'lunar',
    }
  }
  validDate(date)
  const d = dayjs.utc(date)
  const solar = Solar.fromYmd(d.year(), d.month() + 1, d.date())
  const lunar = solar.getLunar()
  const monthName = `${lunar.getMonthInChinese()}月`
  const dayName = lunar.getDayInChinese()
  const solarTerm = lunar.getJieQi() || null
  const next = lunar.getNextJieQi(true)
  const nextDate = next.getSolar().toYmd()
  const festivals = [
    ...new Set([
      ...solar.getFestivals(),
      ...lunar.getFestivals(),
      ...(solarTerm === '清明' ? ['清明节'] : []),
    ]),
  ]
  const info: CalendarDayInfo = {
    date,
    lunar: {
      year: lunar.getYear(),
      month: Math.abs(lunar.getMonth()),
      day: lunar.getDay(),
      leapMonth: lunar.getMonth() < 0,
      monthName,
      dayName,
      label: `${monthName}${dayName}`,
      yearName: lunar.getYearInGanZhi(),
      zodiac: lunar.getYearShengXiao(),
    },
    solarTerm,
    nextSolarTerm: {
      name: next.getName(),
      date: nextDate,
      daysAway: dayjs.utc(nextDate).diff(d, 'day'),
    },
    festivals,
    arrangement: null,
    scheduleKnown: false,
    label:
      festivals[0] ?? solarTerm ?? (lunar.getDay() === 1 ? monthName : dayName),
    labelKind: festivals.length ? 'festival' : solarTerm ? 'term' : 'lunar',
  }
  if (cache.size >= 512) {
    cache.delete(cache.keys().next().value!)
  }
  cache.set(date, info)
  return structuredClone(info)
}
export function calendarDayInfo(
  date: string,
  years: readonly HolidayYearSnapshot[] = [],
): CalendarDayInfo {
  const info = baseDayInfo(date)
  info.arrangement = holidayArrangement(date, years)
  info.scheduleKnown = holidayScheduleKnown(Number(date.slice(0, 4)), years)
  return info
}
export function lunarLabel(date: string): string {
  return calendarDayInfo(date).lunar?.label ?? ''
}
