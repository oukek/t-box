import type {
  CalendarEvent,
  CalendarException,
  CalendarOccurrence,
  ReminderItem,
} from './types.js'
import { DateTimeErrorCode } from '@t-box/dayjs'
import {
  DateTimeError,
  dayjs,
  localInstant,
  validDate,
  validTimezone,
} from '@t-box/time-contracts/index'
import { lunarOccursOn, solarToLunar } from './lunar-events.js'

export function occursOn(event: CalendarEvent, date: string): boolean {
  const anchor = dayjs.utc(event.start.slice(0, 10))
  const day = dayjs.utc(validDate(date))
  const r = event.recurrence
  if (day.isBefore(anchor) || (r.until && date > r.until)) {
    return false
  }
  if (r.frequency === 'none') {
    return anchor.isSame(day)
  }
  if (r.frequency === 'daily') {
    return day.diff(anchor, 'day') % r.interval === 0
  }
  if (r.frequency === 'weekly') {
    const difference =
      day.startOf('isoWeek').diff(anchor.startOf('isoWeek'), 'day') / 7
    return (
      difference % r.interval === 0 &&
      (r.weekdays.length ? r.weekdays : [anchor.isoWeekday()]).includes(
        day.isoWeekday(),
      )
    )
  }
  if (event.lunar) {
    return lunarOccursOn(event, date)
  }
  const months =
    (day.year() - anchor.year()) * 12 + day.month() - anchor.month()
  const targetDay =
    r.monthPolicy === 'last_day'
      ? Math.min(anchor.date(), day.daysInMonth())
      : anchor.date()
  if (r.frequency === 'monthly') {
    return months % r.interval === 0 && day.date() === targetDay
  }
  return (
    (day.year() - anchor.year()) % r.interval === 0 &&
    day.month() === anchor.month() &&
    day.date() === targetDay
  )
}
export function expandCalendar(
  event: CalendarEvent,
  exceptions: readonly CalendarException[],
  from: string,
  to: string,
  timezone: string,
): CalendarOccurrence[] {
  validDate(from)
  validDate(to)
  validTimezone(timezone)
  const start = dayjs.utc(from)
  const finish = dayjs.utc(to)
  const span = finish.diff(start, 'day')
  if (span < 0 || span > 370) {
    throw DateTimeErrorCode.INVALID_DATETIME('日历查询范围最多 371 天')
  }
  const first = dayjs.utc(event.start.slice(0, 10))
  const durationDays = dayjs.utc(event.end.slice(0, 10)).diff(first, 'day')
  // View boundaries are local midnight (compatible in zones whose clocks change at midnight).
  const viewStart = dayjs.tz(from, timezone).valueOf()
  const viewEnd = dayjs
    .tz(finish.add(1, 'day').format('YYYY-MM-DD'), timezone)
    .valueOf()
  const states = new Map(exceptions.map((e) => [e.date, e.state]))
  const result: CalendarOccurrence[] = []
  const wallDuration = event.allDay
    ? 0
    : dayjs.utc(event.end).diff(dayjs.utc(event.start))
  for (
    let day = start.subtract(durationDays + 2, 'day');
    !day.isAfter(finish.add(2, 'day'));
    day = day.add(1, 'day')
  ) {
    const key = day.format('YYYY-MM-DD')
    if (
      key < '1900-01-01' ||
      key > '9999-12-31' ||
      !occursOn(event, key) ||
      states.get(key) === 'skipped'
    ) {
      continue
    }
    let startAt: string
    let endAt: string
    let displayDate: string
    let displayEndDate: string
    try {
      if (event.allDay) {
        const end = day.add(durationDays, 'day')
        const endKey = end.format('YYYY-MM-DD')
        if (key > to || endKey <= from) {
          continue
        }
        startAt = dayjs
          .tz(`${key}T09:00:00`, event.timezone)
          .toISOString()
          .replace('.000Z', 'Z')
        endAt = dayjs
          .tz(endKey, event.timezone)
          .toISOString()
          .replace('.000Z', 'Z')
        displayDate = key
        displayEndDate = end.subtract(1, 'day').format('YYYY-MM-DD')
      } else {
        const local = dayjs.utc(`${key}T${event.start.slice(11)}`)
        const ending = local.add(wallDuration, 'millisecond')
        const a = localInstant(
          local.format('YYYY-MM-DDTHH:mm:ss'),
          event.timezone,
        )
        const b = localInstant(
          ending.format('YYYY-MM-DDTHH:mm:ss'),
          event.timezone,
        )
        if (
          b.valueOf() <= viewStart ||
          a.valueOf() >= viewEnd ||
          b.valueOf() <= a.valueOf()
        ) {
          continue
        }
        startAt = a.toISOString().replace('.000Z', 'Z')
        endAt = b.toISOString().replace('.000Z', 'Z')
        displayDate = a.tz(timezone).format('YYYY-MM-DD')
        displayEndDate = b
          .subtract(1, 'millisecond')
          .tz(timezone)
          .format('YYYY-MM-DD')
      }
    } catch (error) {
      if (error instanceof DateTimeError) {
        continue
      }
      throw error
    }
    result.push({
      event,
      occurrenceDate: key,
      startAt,
      endAt,
      displayDate,
      displayEndDate,
      completed: states.get(key) === 'completed',
      anniversaryYears: ['anniversary', 'birthday'].includes(event.kind)
        ? event.lunar
          ? solarToLunar(key).year - event.lunar.year
          : day.year() - first.year()
        : null,
    })
  }
  return result.sort((a, b) => a.startAt.localeCompare(b.startAt))
}

export function occurrenceReminders(
  occurrences: readonly CalendarOccurrence[],
  now: number,
): ReminderItem[] {
  return occurrences
    .filter((o) => !o.completed)
    .flatMap((o) =>
      o.event.reminders.map((minutes) => ({
        key: `calendar:${o.event.id}:${o.occurrenceDate}:${o.startAt}:${minutes}`,
        title: o.event.title,
        body: o.event.allDay
          ? `全天 · ${o.occurrenceDate}`
          : `${o.event.start.slice(11)} · ${o.event.location || '日历事件'}`,
        at: new Date(Date.parse(o.startAt) - minutes * 60000).toISOString(),
        destination: {
          appId: 'calendar',
          params: { date: o.displayDate, eventId: o.event.id },
        },
      })),
    )
    .filter((r) => Date.parse(r.at) > now)
    .sort((a, b) => a.at.localeCompare(b.at))
}
