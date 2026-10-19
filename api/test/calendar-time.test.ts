import type { CalendarEvent, CalendarEventInput } from '@t-box/shared'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createCalendarModule } from '@t-box/calendar-server/module'
import { planReminders } from '@t-box/device-reminders/planner'
import {
  calculateTime,
  calendarDayInfo,
  expandCalendar,
  localInstant,
  occurrenceReminders,
  occursOn,
  parseCalendarEvent,
  parseTimerInput,
  timerState,
  timeSnapshot,
  transitionTimer,
  validDate,
} from '@t-box/shared'
import {
  durationLabel,
  parseStopwatch,
  stopwatchElapsed,
} from '@t-box/time-contracts'
import { createTimeModule } from '@t-box/time-server/module'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { adaptApplication } from '../src/bootstrap/application-adapter.js'

const base: CalendarEventInput = {
  title: '纪念日',
  description: '',
  location: '',
  kind: 'anniversary',
  color: 'teal',
  allDay: true,
  start: '2024-02-29',
  end: '2024-03-01',
  timezone: 'Asia/Shanghai',
  recurrence: {
    frequency: 'yearly',
    interval: 1,
    weekdays: [],
    until: null,
    monthPolicy: 'skip',
  },
  reminders: [0, 1440],
}
const event = (override: Partial<CalendarEventInput> = {}): CalendarEvent => ({
  ...parseCalendarEvent({ ...base, ...override }),
  id: randomUUID(),
  revision: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})
test('calendar validates dates, durations, reminders and strict input fields', () => {
  assert.throws(() => parseCalendarEvent({ ...base, start: '2025-02-29' }))
  assert.throws(() => parseCalendarEvent({ ...base, end: base.start }))
  assert.throws(() =>
    parseCalendarEvent({ ...base, timezone: 'Imaginary/City' }),
  )
  assert.throws(() => parseCalendarEvent({ ...base, reminders: [1, 1] }))
  assert.throws(() => parseCalendarEvent({ ...base, reminders: [0, 1, 2, 3] }))
  assert.throws(() => parseCalendarEvent({ ...base, userId: 'forged' }))
  assert.throws(() =>
    parseCalendarEvent({
      ...base,
      recurrence: { ...base.recurrence, until: '2023-12-01' },
    }),
  )
})
test('Feb 29 and monthly 31st use explicit skip or last-day semantics', () => {
  const leap = event()
  assert.equal(occursOn(leap, '2025-02-28'), false)
  assert.equal(occursOn(leap, '2028-02-29'), true)
  const clamp = {
    ...leap,
    recurrence: { ...leap.recurrence, monthPolicy: 'last_day' as const },
  }
  assert.equal(occursOn(clamp, '2025-02-28'), true)
  assert.equal(occursOn(clamp, '2024-02-28'), false)
  const month = event({
    start: '2026-01-31',
    end: '2026-02-01',
    recurrence: { ...base.recurrence, frequency: 'monthly' },
  })
  assert.equal(occursOn(month, '2026-02-28'), false)
  assert.equal(
    occursOn(
      {
        ...month,
        recurrence: { ...month.recurrence, monthPolicy: 'last_day' },
      },
      '2026-02-28',
    ),
    true,
  )
  assert.throws(() =>
    expandCalendar(leap, [], '2025-01-01', '2026-02-01', 'UTC'),
  )
})
test('weekly intervals are anchored to ISO weeks, weekdays and cutoff', () => {
  const e = event({
    start: '2026-10-06',
    end: '2026-10-07',
    recurrence: {
      frequency: 'weekly',
      interval: 2,
      weekdays: [1, 3],
      until: '2026-10-21',
      monthPolicy: 'skip',
    },
  })
  assert.equal(occursOn(e, '2026-10-05'), false)
  assert.equal(occursOn(e, '2026-10-07'), true)
  assert.equal(occursOn(e, '2026-10-14'), false)
  assert.equal(occursOn(e, '2026-10-19'), true)
  assert.equal(occursOn(e, '2026-11-02'), false)
})
test('all-day events keep calendar dates across zones, exceptions and reminder offsets', () => {
  const e = event({
    recurrence: { ...base.recurrence, monthPolicy: 'last_day' },
  })
  const out = expandCalendar(
    e,
    [],
    '2025-02-28',
    '2025-02-28',
    'America/Los_Angeles',
  )
  assert.equal(out[0]!.displayDate, '2025-02-28')
  assert.equal(out[0]!.displayEndDate, '2025-02-28')
  assert.equal(out[0]!.anniversaryYears, 1)
  assert.equal(out[0]!.startAt, '2025-02-28T01:00:00Z')
  const complete = expandCalendar(
    e,
    [{ date: '2025-02-28', state: 'completed' }],
    '2025-02-28',
    '2025-02-28',
    'UTC',
  )
  assert.equal(occurrenceReminders(complete, 0).length, 0)
  assert.equal(
    expandCalendar(
      e,
      [{ date: '2025-02-28', state: 'skipped' }],
      '2025-02-28',
      '2025-02-28',
      'UTC',
    ).length,
    0,
  )
  assert.equal(
    occurrenceReminders(out, 0)
      .map((r) => r.at)
      .join(','),
    '2025-02-27T01:00:00.000Z,2025-02-28T01:00:00.000Z',
  )
})
test('timed recurrence preserves wall time and seconds across DST, rejecting ambiguous times', () => {
  const e = event({
    kind: 'event',
    allDay: false,
    start: '2026-03-07T09:00:15',
    end: '2026-03-07T10:00:15',
    timezone: 'America/New_York',
    recurrence: { ...base.recurrence, frequency: 'daily' },
  })
  const out = expandCalendar(e, [], '2026-03-07', '2026-03-09', 'America/New_York')
  assert.deepEqual(
    out.map((o) => o.startAt),
    ['2026-03-07T14:00:15Z', '2026-03-08T13:00:15Z', '2026-03-09T13:00:15Z'],
  )
  assert.throws(() => localInstant('2026-03-08T02:30', 'America/New_York'))
  assert.throws(() => localInstant('2026-11-01T01:30', 'America/New_York'))
  const gap = event({
    kind: 'event',
    allDay: false,
    start: '2026-03-07T02:30',
    end: '2026-03-07T03:30',
    timezone: 'America/New_York',
    recurrence: { ...base.recurrence, frequency: 'daily' },
  })
  assert.deepEqual(
    expandCalendar(gap, [], '2026-03-07', '2026-03-09', 'America/New_York').map(
      (o) => o.occurrenceDate,
    ),
    ['2026-03-07', '2026-03-09'],
  )
})
test('cross-midnight events appear on both days and midnight end is exclusive', () => {
  const e = event({
    kind: 'event',
    allDay: false,
    start: '2026-10-06T23:00',
    end: '2026-10-07T01:00',
    recurrence: { ...base.recurrence, frequency: 'none' },
  })
  assert.equal(
    expandCalendar(e, [], '2026-10-07', '2026-10-07', 'Asia/Shanghai')[0]!
      .displayDate,
    '2026-10-06',
  )
  const midnight = { ...e, end: '2026-10-07T00:00' }
  assert.equal(
    expandCalendar(midnight, [], '2026-10-07', '2026-10-07', 'Asia/Shanghai')
      .length,
    0,
  )
})
test('server snapshot, timestamp, timezone, difference and calendar shifts', () => {
  const s = timeSnapshot('Asia/Shanghai', new Date('2026-10-06T16:00:00Z'))
  assert.equal(s.date, '2026-10-07')
  assert.equal(s.time, '00:00:00')
  assert.equal(s.weekday, 3)
  assert.equal(
    (
      calculateTime({
        kind: 'convert',
        source: 'Asia/Shanghai',
        target: 'UTC',
        value: '2026-10-06T08:00',
      }) as any
    ).local,
    '2026-10-06T00:00:00',
  )
  assert.equal(
    (
      calculateTime({
        kind: 'timestamp',
        source: 'UTC',
        target: 'UTC',
        value: '0',
        unit: 'seconds',
      }) as any
    ).date,
    '1970-01-01',
  )
  assert.equal(
    (
      calculateTime({
        kind: 'difference',
        source: 'America/New_York',
        target: 'America/New_York',
        value: '2026-03-07T12:00',
        end: '2026-03-08T12:00',
      }) as any
    ).hours,
    23,
  )
  assert.equal(
    (
      calculateTime({
        kind: 'shift',
        source: 'UTC',
        value: '2026-01-31T12:00',
        amount: '1',
        unit: 'months',
      }) as any
    ).date,
    '2026-02-28',
  )
  assert.throws(() =>
    calculateTime({
      kind: 'timestamp',
      source: 'UTC',
      value: '9999999999999999',
      unit: 'seconds',
    }),
  )
})
test('timer transitions preserve remainder, absolute deadlines and completion after suspension', () => {
  const origin = {
    label: '测试',
    durationSeconds: 60,
    status: 'running' as const,
    remainingMs: 60000,
    deadline: new Date(60000).toISOString(),
  }
  const paused = transitionTimer(origin, 'pause', 25000)
  assert.equal(paused.remainingMs, 35000)
  assert.equal(paused.deadline, null)
  const resumed = transitionTimer(paused, 'resume', 100000)
  assert.equal(resumed.deadline, new Date(135000).toISOString())
  assert.equal(timerState(resumed, 140000).status, 'completed')
  assert.throws(() => transitionTimer(resumed, 'resume', 101000))
  assert.equal(
    transitionTimer(resumed, 'restart', 200000).deadline,
    new Date(260000).toISOString(),
  )
  assert.equal(transitionTimer(resumed, 'cancel', 200000).deadline, null)
})
test('reminder planner preserves imminent notifications, updates changed entries, cancels removed or foreign alarms and caps queue', () => {
  const now = 100000
  const items = [
    {
      key: 'first',
      title: '标题',
      body: '提醒',
      at: new Date(now + 500).toISOString(),
      destination: { appId: 'time', params: {} },
    },
  ]
  let p = planReminders('a', items, { owner: 'a', notifications: [] }, [], now)
  assert.equal(p.schedule.length, 1)
  let next = planReminders(
    'a',
    items,
    p.plan,
    p.plan.notifications.map((n) => n.id),
    now + 200,
  )
  assert.deepEqual(next.cancel, [])
  assert.deepEqual(next.schedule, [])
  next = planReminders(
    'a',
    [{ ...items[0]!, title: '新标题' }],
    p.plan,
    p.plan.notifications.map((n) => n.id),
    now,
  )
  assert.equal(next.cancel.length, 1)
  assert.equal(next.schedule[0]!.id, p.plan.notifications[0]!.id)
  assert.equal(
    planReminders('b', items, p.plan, [p.plan.notifications[0]!.id], now).cancel
      .length,
    1,
  )
  assert.equal(
    planReminders('a', [], p.plan, [p.plan.notifications[0]!.id], now).cancel
      .length,
    1,
  )
  p = planReminders(
    'a',
    Array.from({ length: 70 }, (_, i) => ({
      ...items[0]!,
      key: String(i),
      at: new Date(now + 1000 + i).toISOString(),
    })),
    { owner: 'a', notifications: [] },
    [],
    now,
  )
  assert.equal(p.plan.notifications.length, 48)
  assert.equal(p.truncated, true)
  assert.equal(new Set(p.plan.notifications.map((n) => n.id)).size, 48)
})
test('stopwatch persistence validates state and restores running elapsed time', () => {
  assert.deepEqual(parseStopwatch({ elapsed: -1, laps: [], startedAt: null }), {
    elapsed: 0,
    startedAt: null,
    laps: [],
  })
  assert.equal(
    stopwatchElapsed({ elapsed: 10, startedAt: 100, laps: [] }, 210),
    120,
  )
  assert.equal(durationLabel(3661120, true), '01:01:01.12')
})
test('calendar and time register independent tools, skills, specialist agents and server time is always available', () => {
  const registry = new CapabilityRegistry([
    adaptApplication(createCalendarModule()),
    adaptApplication(createTimeModule()),
  ])
  assert.equal(registry.capabilities('calendar').tools.length, 10)
  assert.equal(registry.capabilities('time').tools.length, 6)
  assert.ok(
    registry.allowedTools(new Set()).some((t) => t.name === 'time_now'),
  )
  assert.ok(
    !registry
      .allowedTools(new Set())
      .some((t) => t.name === 'calendar_event_create'),
  )
  assert.equal(
    registry
      .capabilities('calendar')
      .tools
      .find((t) => t.name === 'calendar_event_delete')!.confirmation,
    true,
  )
})

test('dense calendar queries retain earliest instances from older series when hitting the global limit', async () => {
  const { CalendarService } = await import('@t-box/calendar-server/service')
  const recurring = {
    ...base,
    kind: 'event' as const,
    allDay: false,
    start: '2026-10-01T12:00',
    end: '2026-10-01T13:00',
    timezone: 'UTC',
    recurrence: { ...base.recurrence, frequency: 'daily' as const },
  }
  const inputs = [
    ...Array.from({ length: 14 }, () => ({ ...recurring })),
    {
      ...recurring,
      title: '不能遗漏的早晨',
      start: '2026-10-01T00:00',
      end: '2026-10-01T01:00',
      recurrence: { ...base.recurrence, frequency: 'none' as const },
    },
  ]
  const rows = inputs.map((data) => ({
    data,
    id: randomUUID(),
    revision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }))
  const mock = {
    getRepository: () => ({ find: async () => rows, findBy: async () => [] }),
  }
  const result = await new CalendarService(mock as any).occurrences('fixture', {
    from: '2026-10-01',
    to: '2027-09-30',
    timezone: 'UTC',
  })
  assert.equal(result.truncated, true)
  assert.equal(result.occurrences.length, 5000)
  assert.equal(result.occurrences[0]!.event.id, rows.at(-1)!.id)
})

test('Day.js strict input validation and DST shifts preserve calendar versus elapsed units', () => {
  for (const date of ['2026-02-29', '2026-01-33', '2026-13-01', '1899-12-31']) {
    assert.throws(() => validDate(date))
  }
  assert.equal(validDate('2000-02-29'), '2000-02-29')
  for (const value of [
    '2026-10-06T24:00',
    '2026-10-06T12:60',
    '2026-10-06T12:00:60',
  ]) {
    assert.throws(() => localInstant(value, 'UTC'))
  }
  assert.throws(() => localInstant('2026-10-04T02:15', 'Australia/Lord_Howe'))
  assert.throws(() => localInstant('2026-04-05T01:45', 'Australia/Lord_Howe'))
  const shift = (value: string, amount: string, unit: string) =>
    calculateTime({
      kind: 'shift',
      source: 'America/New_York',
      value,
      amount,
      unit,
    }) as ReturnType<typeof timeSnapshot>
  assert.equal(
    shift('2026-03-07T12:00', '1', 'days').local,
    '2026-03-08T12:00:00',
  )
  assert.equal(
    shift('2026-03-07T12:00', '24', 'hours').local,
    '2026-03-08T13:00:00',
  )
  assert.equal(
    shift('2026-03-07T02:30', '1', 'days').local,
    '2026-03-08T03:30:00',
  )
  assert.equal(shift('2026-10-31T12:00', '1', 'days').offset, '-05:00')
  assert.equal(shift('2024-02-29T12:00', '1', 'years').date, '2025-02-28')
  const s = timeSnapshot('UTC', new Date('2027-01-01T00:00:00Z'))
  assert.equal(s.yearOfWeek, 2026)
  assert.equal(s.weekOfYear, 53)
})
test('Chinese almanac includes lunar dates, leap months, solar terms and festivals without inventing holiday schedules', () => {
  const spring = calendarDayInfo('2026-02-17')
  assert.equal(spring.lunar?.label, '正月初一')
  assert.equal(spring.lunar?.yearName, '丙午')
  assert.equal(spring.lunar?.zodiac, '马')
  assert.ok(spring.festivals.includes('春节'))
  assert.ok(calendarDayInfo('2026-06-19').festivals.includes('端午节'))
  assert.ok(calendarDayInfo('2026-09-25').festivals.includes('中秋节'))
  assert.equal(calendarDayInfo('2026-10-08').solarTerm, '寒露')
  assert.equal(calendarDayInfo('2025-07-25').lunar?.leapMonth, true)
  assert.equal(calendarDayInfo('2025-07-25').lunar?.label, '闰六月初一')
  assert.ok(calendarDayInfo('2026-10-01').festivals.includes('国庆节'))
  assert.equal(
    calendarDayInfo('2026-10-07', [
      {
        region: 'CN',
        year: 2026,
        revision: 1,
        publishedAt: null,
        data: {
          year: 2026,
          papers: ['https://www.gov.cn/'],
          days: [{ date: '2026-10-07', name: '国庆节', status: 'rest' }],
        },
      },
    ]).arrangement?.status,
    'rest',
  )
  assert.equal(
    calendarDayInfo('2026-10-10', [
      {
        region: 'CN',
        year: 2026,
        revision: 1,
        publishedAt: null,
        data: {
          year: 2026,
          papers: ['https://www.gov.cn/'],
          days: [{ date: '2026-10-10', name: '国庆节', status: 'work' }],
        },
      },
    ]).arrangement?.status,
    'work',
  )
  assert.equal(calendarDayInfo('2026-10-08').arrangement, null)
  assert.ok(calendarDayInfo('2027-10-01').festivals.includes('国庆节'))
  assert.equal(calendarDayInfo('2027-10-01').scheduleKnown, false)
  assert.equal(calendarDayInfo('2027-10-01').arrangement, null)
  assert.equal(calendarDayInfo('2101-01-01').lunar, null)
  // Callers cannot corrupt cached almanac data.
  spring.festivals.length = 0
  assert.ok(calendarDayInfo('2026-02-17').festivals.includes('春节'))
})

test('timer input is validated identically before UI submission and server persistence', () => {
  assert.deepEqual(parseTimerInput({ label: '  专注  ', durationSeconds: 60 }), { label: '专注', durationSeconds: 60 })
  for (const value of [null, [], { label: 'test', durationSeconds: 0 }, { label: '', durationSeconds: 1 }, { label: 'x'.repeat(101), durationSeconds: 1 }, { label: 'test', durationSeconds: '60' }, { label: 'test', durationSeconds: 604801 }, { label: 'test', durationSeconds: 1, userId: 'other' }]) {
    assert.throws(() => parseTimerInput(value))
  }
})
