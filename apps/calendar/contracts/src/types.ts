import type { ApplicationClientInteraction, ApplicationManifest } from '@t-box/app-contracts'
import { applicationIcon } from './icon.js'

export type CalendarKind = 'event' | 'anniversary' | 'birthday' | 'task'
export type CalendarFrequency =
  'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export interface CalendarRecurrence {
  frequency: CalendarFrequency
  interval: number
  weekdays: number[]
  until: string | null
  monthPolicy: 'skip' | 'last_day'
}
export interface CalendarEventInput {
  title: string
  description: string
  location: string
  kind: CalendarKind
  color: 'teal' | 'blue' | 'purple' | 'orange' | 'rose'
  allDay: boolean
  start: string
  end: string
  timezone: string
  /** Absent/null means Gregorian, including events created before lunar support. */
  lunar?: CalendarLunarDate | null
  recurrence: CalendarRecurrence
  reminders: number[]
}
export interface CalendarLunarDate {
  year: number
  month: number
  day: number
  leapMonth: boolean
  /** Annual recurrence of a leap-month anchor when that leap month is absent. */
  leapPolicy: 'regular' | 'skip'
}
export interface CalendarEvent extends CalendarEventInput {
  id: string
  revision: number
  createdAt: string
  updatedAt: string
}
export interface CalendarException {
  date: string
  state: 'skipped' | 'completed'
}
export interface CalendarOccurrence {
  event: CalendarEvent
  occurrenceDate: string
  startAt: string
  endAt: string
  displayDate: string
  displayEndDate: string
  completed: boolean
  anniversaryYears: number | null
}
export interface ReminderItem {
  key: string
  title: string
  body: string
  at: string
  destination: { appId: string, params: Record<string, string> }
}
export const calendarManifest = {
  id: 'calendar',
  name: '日历',
  description: '日程安排、重要纪念日与提醒。',
  icon: 'calendar',
  iconAsset: applicationIcon,
  iconVariant: 'calendar',
  color: 'orange',
  version: '1.1.3',
  skillIds: ['calendar_planning'],
} as const satisfies ApplicationManifest
export const calendarClientInteractions = [
  {
    name: 'calendar_reminders_sync',
    title: '同步日历提醒',
    purpose: 'ui',
    description: '同步当前设备的日历与倒计时提醒；不自动申请通知权限。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'calendar_confirm',
    title: '删除日历事件确认',
    purpose: 'confirmation',
    description: '删除整个事件或重复日程前，让用户确认。',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, message: { type: 'string' } },
      required: ['title', 'message'],
      additionalProperties: false,
    },
  },
] as const satisfies readonly ApplicationClientInteraction[]
