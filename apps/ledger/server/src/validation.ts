import type { BillInput } from '@t-box/ledger-contracts'
import { invalid } from '@t-box/server-foundation/errors'
import { parseId } from '@t-box/server-foundation/validation'

import { attachmentIds } from './features/attachment-input.js'

export interface ListFilters {
  month?: string
  type?: BillInput['type']
  q?: string
  page: number
  pageSize: number
}

const BILL_FIELDS = new Set([
  'type',
  'amount',
  'category',
  'date',
  'note',
  'accountId',
  'attachmentResourceIds',
])

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(field, '必须是 JSON 对象')
  }
  return value as Record<string, unknown>
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function validateMonth(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(value)
  ) {
    invalid('month', '月份格式应为 YYYY-MM（年份 1000–9999）')
  }
  return value
}

export function monthBounds(month: string): [string, string] {
  const year = Number(month.slice(0, 4))
  const number = Number(month.slice(5, 7))
  return [`${month}-01`, `${month}-${daysInMonth(year, number)}`]
}

export function parseBillInput(
  value: unknown,
  partial = false,
): Partial<BillInput> {
  const body = record(value, 'body')
  for (const key of Object.keys(body)) {
    if (!BILL_FIELDS.has(key)) {
      invalid(key, '不支持的字段')
    }
  }
  if (partial && Object.keys(body).length === 0) {
    invalid('body', '请至少提供一个要修改的字段')
  }
  const output: Partial<BillInput> = {}
  for (const field of BILL_FIELDS) {
    if (!(field in body)) {
      if (
        !partial &&
        field !== 'accountId' &&
        field !== 'attachmentResourceIds'
      ) {
        invalid(field, '此字段必填')
      }
      continue
    }
    const entry = body[field]
    if (field === 'attachmentResourceIds') {
      output.attachmentResourceIds = attachmentIds(entry)
    } else if (field === 'type') {
      if (entry !== 'expense' && entry !== 'income') {
        invalid(field, '请选择收入或支出')
      }
      output.type = entry
    } else if (field === 'amount') {
      if (
        typeof entry !== 'string' ||
        !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(entry)
      ) {
        invalid(field, '金额须为十进制字符串，最多两位小数，最大 999999999.99')
      }
      const [whole, fraction = ''] = entry.split('.')
      if (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0')) === 0n) {
        invalid(field, '金额必须大于零')
      }
      output.amount = `${whole}.${fraction.padEnd(2, '0')}`
    } else if (field === 'category') {
      if (typeof entry !== 'string' || !/^[\w-]{1,36}$/.test(entry)) {
        invalid(field, '请选择有效分类')
      }
      output.category = entry as BillInput['category']
    } else if (field === 'date') {
      if (
        typeof entry !== 'string' ||
        !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(entry)
      ) {
        invalid(field, '日期格式应为 YYYY-MM-DD（年份 1000–9999）')
      }
      if (
        Number(entry.slice(8, 10)) >
        daysInMonth(Number(entry.slice(0, 4)), Number(entry.slice(5, 7)))
      ) {
        invalid(field, '请输入真实存在的日期')
      }
      output.date = entry
    } else if (field === 'accountId') {
      output.accountId = entry === null ? null : parseId(entry)
    } else if (field === 'note') {
      if (typeof entry !== 'string' || entry.length > 200) {
        invalid(field, '备注最多 200 字')
      }
      output.note = entry.trim()
    }
  }
  return output
}

export function parseListFilters(value: unknown): ListFilters {
  const query = record(value, 'query')
  const allowed = new Set(['month', 'type', 'q', 'page', 'pageSize'])
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) {
      invalid(key, '不支持的查询参数')
    }
  }
  const filters: ListFilters = {
    page: parsePage(query.page, 'page', 1, 1_000_000),
    pageSize: parsePage(query.pageSize, 'pageSize', 20, 100),
  }
  const month = validateMonth(query.month)
  if (month) {
    filters.month = month
  }
  if (query.type !== undefined) {
    if (query.type !== 'expense' && query.type !== 'income') {
      invalid('type', '请选择收入或支出')
    }
    filters.type = query.type
  }
  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.length > 100) {
      invalid('q', '搜索文本最多 100 字')
    }
    if (query.q.trim()) {
      filters.q = query.q.trim()
    }
  }
  return filters
}

function parsePage(
  value: unknown,
  field: string,
  fallback: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback
  }
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    Number(value) > max
  ) {
    invalid(field, `必须为 1–${max} 的整数`)
  }
  return Number(value)
}

export function parseSummaryQuery(value: unknown): string | undefined {
  const query = record(value, 'query')
  for (const key of Object.keys(query)) {
    if (key !== 'month') {
      invalid(key, '不支持的查询参数')
    }
  }
  return validateMonth(query.month)
}

export { parseId }
