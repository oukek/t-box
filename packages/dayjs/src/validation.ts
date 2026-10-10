import type { Dayjs } from './configured.js'
import { dayjs } from './configured.js'

export class DateTimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DateTimeError'
  }
}
export function validTimezone(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    !value.trim() ||
    /^[+-]/.test(value)
  ) {
    throw new DateTimeError('请使用 IANA 时区名称，例如 Asia/Shanghai')
  }
  try {
    // eslint-disable-next-line no-new -- Construction validates the IANA zone; the formatter is intentionally discarded.
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    throw new DateTimeError('时区名称无效')
  }
}
export function validDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    value > '9999-12-31'
  ) {
    throw new DateTimeError('日期范围为 1900-01-01 至 9999-12-31')
  }
  if (!dayjs.utc(value, 'YYYY-MM-DD', true).isValid()) {
    throw new DateTimeError('日期不存在')
  }
  return value
}
const offsetCache = new Map<string, number[]>()
/** Day.js normalizes gaps/overlaps by default; user-entered event times must be unambiguous. */
export function localInstant(
  value: unknown,
  zone: string,
  policy: 'reject' | 'compatible' = 'reject',
): Dayjs {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)
  ) {
    throw new DateTimeError('日期时间格式应为 YYYY-MM-DDTHH:mm')
  }
  validDate(value.slice(0, 10))
  validTimezone(zone)
  const format =
    value.length === 16 ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DDTHH:mm:ss'
  const wall = dayjs.utc(value, format, true)
  if (!wall.isValid()) {
    throw new DateTimeError('日期时间不存在')
  }
  const key = `${zone}:${value.slice(0, 10)}`
  let offsets = offsetCache.get(key)
  if (!offsets) {
    const noon = dayjs.utc(`${value.slice(0, 10)}T12:00:00`).valueOf()
    offsets = [
      ...new Set(
        [-36, 0, 36].map((hours) =>
          dayjs
            .utc(noon + hours * 3600000)
            .tz(zone)
            .utcOffset(),
        ),
      ),
    ]
    if (offsetCache.size >= 512) {
      offsetCache.delete(offsetCache.keys().next().value!)
    }
    offsetCache.set(key, offsets)
  }
  const candidates = offsets
    .map((offset) => dayjs.utc(wall.valueOf() - offset * 60000))
    .filter((instant) => instant.tz(zone).format(format) === value)
    .sort((a, b) => a.valueOf() - b.valueOf())
  if (candidates.length === 1) {
    return candidates[0]!
  }
  if (policy === 'compatible') {
    if (candidates.length) {
      return candidates[0]!
    }
    // In a spring-forward gap, advance by the offset transition instead of silently changing the clock fields.
    const shifted = offsets
      .map((offset) => dayjs.utc(wall.valueOf() - offset * 60000))
      .filter((instant) => instant.tz(zone).format(format) > value)
      .sort((a, b) => a.valueOf() - b.valueOf())[0]
    if (shifted) {
      return shifted
    }
  }
  throw new DateTimeError('此当地时间不存在或因夏令时重复，请选择明确的时间')
}
