import { defineApiErrors } from '@t-box/errors'

export const TodoError = defineApiErrors({
  TODO_INVALID: { statusCode: 400, message: '事项内容无效' },
  TODO_CONFLICT: {
    statusCode: 409,
    message: '此事项已在其他设备修改，请重新打开后编辑',
  },
  TODO_INSTALLATION: {
    statusCode: 403,
    message: '应用安装状态已变化，请重新打开',
  },
})
export type Kind = 'task' | 'list' | 'plan' | 'period'
export interface Step {
  milestone?: boolean
  stage?: string
  created?: string
  urgent?: boolean
  id: string
  title: string
  date: string
  done: string
}
export interface Rule {
  unit: 'day' | 'week' | 'month'
  interval: number
  weekdays: number[]
  lastDay: boolean
  zone: string
}
export interface Item {
  note?: string
  reminder?: boolean
  origin?: string
  id: string
  kind: Kind
  title: string
  date: string
  end: string
  time: string
  due: string
  urgent: boolean
  done: string
  paused: boolean
  steps: Step[]
  rule: Rule | null
  series: string
  scheduled: string
  skipped: boolean
}
export interface Saved {
  until?: string
  item: Item
  revision: number
  created: string
}
export function newItem(kind: Kind, date = ''): Item {
  return {
    id: crypto.randomUUID(),
    kind,
    title: '',
    note: '',
    date,
    end: '',
    time: '',
    due: '',
    urgent: false,
    done: '',
    paused: false,
    steps: [],
    rule:
      kind === 'list'
        ? {
            unit: 'week',
            interval: 1,
            weekdays: [new Date(date + 'T12:00:00Z').getUTCDay() || 0],
            lastDay: false,
            zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
        : null,
    series: '',
    scheduled: '',
    skipped: false,
  }
}
const isoDay = /^\d{4}-\d{2}-\d{2}$/
const validDate = (d: unknown): d is string =>
  typeof d === 'string' &&
  (!d ||
    (isoDay.test(d) &&
      !Number.isNaN(Date.parse(d)) &&
      new Date(d).toISOString().slice(0, 10) === d))
const idPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/
const stamp = (s: unknown) =>
  typeof s === 'string' &&
  (!s ||
    (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) &&
      Number.isFinite(Date.parse(s))))
function check(ok: unknown, msg: string): asserts ok {
  if (!ok) {
    throw TodoError.TODO_INVALID(msg)
  }
}
export function validate(v: unknown): Item {
  check(v && typeof v === 'object', '请填写事项')
  check(JSON.stringify(v).length <= 65000, '事项内容过长，请拆分步骤')
  const x = v as Item
  check(['task', 'plan', 'list', 'period'].includes(x.kind), '类型无效')
  check(
    typeof x.title === 'string' && x.title.trim() && x.title.length <= 200,
    '标题须为 1–200 个字符',
  )
  check(x.note === undefined || (typeof x.note === 'string' && x.note.length <= 4000), '备注最多 4000 字')
  check(
    [x.date, x.end, x.due, x.scheduled].every(validDate) &&
    (!x.date || !x.end || x.date <= x.end),
    '日期或日期范围无效',
  )
  check(
    typeof x.time === 'string' &&
    (!x.time || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x.time)),
    '时间无效',
  )
  check(
    x.origin === undefined ||
    (typeof x.origin === 'string' && x.origin.length <= 240),
    '来源无效',
  )
  check(
    x.reminder === undefined ||
    (typeof x.reminder === 'boolean' && (!x.reminder || !!x.date)),
    '请给提醒设置日期',
  )
  check(
    stamp(x.done) &&
    [x.urgent, x.paused, x.skipped].every((t) => typeof t === 'boolean'),
    '状态无效',
  )
  check(
    Array.isArray(x.steps) &&
    x.steps.length <= 150 &&
    (!['task'].includes(x.kind) || !x.steps.length),
    '步骤数量无效',
  )
  const ids = new Set<string>()
  for (const step of x.steps) {
    check(
      step &&
      (step.urgent === undefined || typeof step.urgent === 'boolean') &&
      idPattern.test(step.id) &&
      !ids.has(step.id) &&
      typeof step.title === 'string' &&
      step.title.trim() &&
      step.title.length <= 200 &&
      validDate(step.date) &&
      stamp(step.done),
      '子事项无效',
    )
    check(step.milestone === undefined || (typeof step.milestone === 'boolean' && x.kind === 'plan'), '里程碑设置无效')
    check(step.stage === undefined || (typeof step.stage === 'string' && step.stage.length <= 80), '阶段名称过长')
    check(step.created === undefined || stamp(step.created), '创建时间无效')
    ids.add(step.id)
  }
  if (x.kind === 'period') {
    check(
      idPattern.test(x.series) &&
      x.scheduled &&
      x.date &&
      x.id === x.series + '_' + x.scheduled,
      '期次无效',
    )
  } else {
    check(
      idPattern.test(x.id) && x.series === '' && x.scheduled === '',
      '事项标识无效',
    )
  }
  if (x.kind === 'list') {
    const r = x.rule
    check(
      r &&
      x.date &&
      ['day', 'week', 'month'].includes(r.unit) &&
      Number.isInteger(r.interval) &&
      r.interval >= 1 &&
      r.interval <= 52,
      '请设置重复日期与间隔（1–52）',
    )
    check(
      typeof r.lastDay === 'boolean' &&
      Array.isArray(r.weekdays) &&
      r.weekdays.length <= 7 &&
      r.weekdays.every((n) => Number.isInteger(n) && n >= 0 && n <= 6) &&
      (r.unit !== 'week' || r.weekdays.length),
      '请选择重复星期',
    )
    try {
      new Intl.DateTimeFormat('en', { timeZone: r.zone }).format()
    } catch {
      throw TodoError.TODO_INVALID('时区无效')
    }
    check(typeof r.zone === 'string' && r.zone.length <= 80, '时区无效')
  } else {
    check(x.rule === null, '重复规则无效')
  }
  return x
}
const dayMs = 86400000
export const shift = (day: string, n: number) =>
  new Date(Date.parse(day) + n * dayMs).toISOString().slice(0, 10)
export function localDay(date = new Date(), zone?: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
export function occurs(series: Item, day: string) {
  const r = series.rule
  if (
    !r ||
    series.paused ||
    day < series.date ||
    (series.end && day > series.end)
  ) {
    return false
  }
  const d = new Date(day)
  const start = new Date(series.date)
  const days = (+d - +start) / dayMs
  if (r.unit === 'day') {
    return days % r.interval === 0
  }
  if (r.unit === 'week') {
    return (
      Math.floor((days + ((start.getUTCDay() + 6) % 7)) / 7) % r.interval ===
      0 && r.weekdays.includes(d.getUTCDay())
    )
  }
  const months =
    (d.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    d.getUTCMonth() -
    start.getUTCMonth()
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate()
  return (
    months % r.interval === 0 &&
    d.getUTCDate() === (r.lastDay ? last : Math.min(start.getUTCDate(), last))
  )
}
export function period(series: Item, date: string): Item {
  return {
    ...series,
    id: series.id + '_' + date,
    kind: 'period',
    series: series.id,
    scheduled: date,
    date,
    rule: null,
    end: '',
    done: '',
    skipped: false,
    steps: series.steps.map((s) => ({ ...s, done: '' })),
  }
}

// Configuration snapshots apply through their local calendar date (inclusive).
export function seriesAt(
  current: Item,
  history: readonly Saved[],
  date: string,
) {
  return (
    history.find((s) => s.item.id === current.id && s.until! >= date)?.item ??
    current
  )
}
