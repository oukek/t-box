import { invalid } from './errors.js'

export function parseId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    invalid('id', 'ID 格式不正确')
  }
  return value
}

export function parseDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)
  ) {
    invalid('localDate', '日期格式应为 YYYY-MM-DD')
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    invalid('localDate', '请输入真实存在的日期')
  }
  return value
}
