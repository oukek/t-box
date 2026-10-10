import type { CalendarEventInput } from './types.js'
import {
  DateTimeError,
  dayjs,
  localInstant,
  validDate,
  validTimezone,
} from '@t-box/time-contracts/index'
import { lunarToSolar } from './lunar-events.js'

export const calendarKinds = [
  { value: 'event', label: '日程' },
  { value: 'anniversary', label: '纪念日' },
  { value: 'birthday', label: '生日' },
  { value: 'task', label: '待办' },
] as const
export const calendarColors = [
  { value: 'teal', label: '青绿' },
  { value: 'blue', label: '蓝色' },
  { value: 'purple', label: '紫色' },
  { value: 'orange', label: '橙色' },
  { value: 'rose', label: '玫红' },
] as const
export const recurrenceOptions = [
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
] as const
export function calendarObject(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DateTimeError('参数必须为对象')
  }
  const result = value as Record<string, unknown>
  if (Object.keys(result).some((k) => !fields.includes(k))) {
    throw new DateTimeError('参数包含未知字段')
  }
  return result
}
const string = (v: unknown, label: string, max: number, required = false) => {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) {
    throw new DateTimeError(
      `${label}${required ? '不能为空，且' : ''}最多 ${max} 个字符`,
    )
  }
  return v.trim()
}
export function parseCalendarLunarDate(
  value: unknown,
): NonNullable<CalendarEventInput['lunar']> {
  const l = calendarObject(value, [
    'year',
    'month',
    'day',
    'leapMonth',
    'leapPolicy',
  ])
  if (
    !Number.isInteger(l.year) ||
    !Number.isInteger(l.month) ||
    Number(l.month) < 1 ||
    Number(l.month) > 12 ||
    !Number.isInteger(l.day) ||
    typeof l.leapMonth !== 'boolean' ||
    !['regular', 'skip'].includes(String(l.leapPolicy))
  ) {
    throw new DateTimeError('农历日期或闰月规则无效')
  }
  const lunar = {
    year: Number(l.year),
    month: Number(l.month),
    day: Number(l.day),
    leapMonth: l.leapMonth,
    leapPolicy: l.leapPolicy as 'regular' | 'skip',
  }
  lunarToSolar(lunar)
  return lunar
}
export function parseCalendarEvent(value: unknown): CalendarEventInput {
  const a = calendarObject(value, [
    'title',
    'description',
    'location',
    'kind',
    'color',
    'allDay',
    'start',
    'end',
    'timezone',
    'recurrence',
    'reminders',
    'lunar',
  ])
  const title = string(a.title, '标题', 100, true)
  const description = string(a.description, '备注', 2000)
  const location = string(a.location, '地点', 200)
  const timezone = validTimezone(a.timezone)
  if (
    !calendarKinds.some((k) => k.value === a.kind) ||
    !calendarColors.some((k) => k.value === a.color) ||
    typeof a.allDay !== 'boolean'
  ) {
    throw new DateTimeError('事件类型、颜色或全天设置无效')
  }
  if (typeof a.start !== 'string' || typeof a.end !== 'string') {
    throw new DateTimeError('开始和结束时间无效')
  }
  let lunar: CalendarEventInput['lunar'] = null
  if (a.lunar != null) {
    lunar = parseCalendarLunarDate(a.lunar)
    if (lunarToSolar(lunar) !== a.start.slice(0, 10)) {
      throw new DateTimeError('开始日期与农历日期对应的公历日期不一致')
    }
  }
  let days: number
  if (a.allDay) {
    validDate(a.start)
    validDate(a.end)
    days = dayjs.utc(a.end).diff(dayjs.utc(a.start), 'day')
    if (days < 1 || days > 31) {
      throw new DateTimeError(
        '全天事件结束日期不包含当天，需比开始晚 1 至 31 天',
      )
    }
  } else {
    const start = localInstant(a.start, timezone)
    const end = localInstant(a.end, timezone)
    if (
      end.valueOf() <= start.valueOf() ||
      end.valueOf() - start.valueOf() > 31 * 86400000
    ) {
      throw new DateTimeError('结束时间应晚于开始，跨度最多 31 天')
    }
  }
  const r = calendarObject(a.recurrence, [
    'frequency',
    'interval',
    'weekdays',
    'until',
    'monthPolicy',
  ])
  if (
    !recurrenceOptions.some((f) => f.value === r.frequency) ||
    !Number.isInteger(r.interval) ||
    Number(r.interval) < 1 ||
    Number(r.interval) > 99 ||
    !['skip', 'last_day'].includes(String(r.monthPolicy))
  ) {
    throw new DateTimeError('重复规则无效')
  }
  if (
    !Array.isArray(r.weekdays) ||
    r.weekdays.length > 7 ||
    r.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7) ||
    new Set(r.weekdays).size !== r.weekdays.length
  ) {
    throw new DateTimeError('星期需为 1 至 7 的不重复整数')
  }
  const until = r.until === null ? null : validDate(r.until)
  if (until && until < a.start.slice(0, 10)) {
    throw new DateTimeError('重复结束日期不能早于开始日期')
  }
  if (
    !Array.isArray(a.reminders) ||
    a.reminders.length > 3 ||
    a.reminders.some((n) => !Number.isInteger(n) || n < 0 || n > 43200) ||
    new Set(a.reminders).size !== a.reminders.length
  ) {
    throw new DateTimeError('提醒最多 3 个，提前分钟数范围 0 至 43200')
  }
  return {
    title,
    description,
    location,
    kind: a.kind as CalendarEventInput['kind'],
    color: a.color as CalendarEventInput['color'],
    allDay: a.allDay,
    start: a.start,
    end: a.end,
    timezone,
    lunar,
    recurrence: {
      frequency: r.frequency as CalendarEventInput['recurrence']['frequency'],
      interval: Number(r.interval),
      weekdays: [...r.weekdays].sort((a, b) => a - b),
      until,
      monthPolicy: r.monthPolicy as 'skip' | 'last_day',
    },
    reminders: [...a.reminders].sort((a, b) => a - b),
  }
}
export function parseCalendarParams(value: unknown): Record<string, string> {
  const args = calendarObject(value, ['date', 'view', 'eventId'])
  const result: Record<string, string> = {}
  if (args.date != null) {
    result.date = validDate(args.date)
  }
  if (args.view != null) {
    if (!['month', 'agenda', 'anniversaries'].includes(String(args.view))) {
      throw new DateTimeError('日历视图不存在')
    }
    result.view = String(args.view)
  }
  if (args.eventId != null) {
    if (
      typeof args.eventId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(args.eventId)
    ) {
      throw new DateTimeError('事件 ID 无效')
    }
    result.eventId = args.eventId
  }
  return result
}
