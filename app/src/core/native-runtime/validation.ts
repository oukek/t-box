import type { DeviceCalendarDraft, DeviceCapability } from '@t-box/app-contracts'
import { deviceCapabilities } from '@t-box/app-contracts'
import { SdkErrorCode } from '@t-box/app-sdk'

const fail = () => {
  throw SdkErrorCode.INVALID_ARGUMENTS('设备操作参数无效')
}
export function deviceObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail()
  }
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    fail()
  }
}
function text(value: unknown, limit: number, optional = false): string | undefined {
  if (optional && value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > limit || /\0/.test(value)) {
    return fail()
  }
  return value
}
function instant(value: unknown): string {
  const raw = text(value, 64)!
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(raw) || !Number.isFinite(Date.parse(raw))) {
    return fail()
  }
  return raw
}
export function parseDeviceCapability(value: unknown): DeviceCapability {
  if (!deviceCapabilities.includes(value as DeviceCapability)) {
    return fail()
  }
  return value as DeviceCapability
}
export function parseDeviceCapabilities(value: unknown): DeviceCapability[] {
  if (!Array.isArray(value) || !value.length || value.length > deviceCapabilities.length) {
    return fail()
  }
  const result = value.map(parseDeviceCapability)
  if (new Set(result).size !== result.length) {
    return fail()
  }
  return result
}
export function parseCalendarDraft(value: unknown): DeviceCalendarDraft {
  const input = deviceObject(value)
  keys(input, ['title', 'startAt', 'endAt', 'timeZone', 'allDay', 'location', 'notes', 'reminderMinutes'])
  const startAt = instant(input.startAt)
  const endAt = instant(input.endAt)
  if (Date.parse(endAt) <= Date.parse(startAt) || (input.allDay !== undefined && typeof input.allDay !== 'boolean')) {
    return fail()
  }
  if (input.timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: text(input.timeZone, 100) }).resolvedOptions()
    } catch {
      return fail()
    }
  }
  if (input.reminderMinutes !== undefined && (!Array.isArray(input.reminderMinutes) || input.reminderMinutes.length > 3 || input.reminderMinutes.some((v) => !Number.isSafeInteger(v) || v < 0 || v > 40320))) {
    return fail()
  }
  return { title: text(input.title, 200)!, startAt, endAt, ...(input.timeZone ? { timeZone: String(input.timeZone) } : {}), ...(input.allDay !== undefined ? { allDay: input.allDay as boolean } : {}), ...(input.location !== undefined ? { location: text(input.location, 500, true) } : {}), ...(input.notes !== undefined ? { notes: text(input.notes, 5000, true) } : {}), ...(input.reminderMinutes !== undefined ? { reminderMinutes: input.reminderMinutes as number[] } : {}) }
}
export function parseDeviceInput(capability: DeviceCapability, value: unknown): Record<string, unknown> {
  const input = deviceObject(value)
  if (['calendar.create', 'calendar.presentCreate'].includes(capability)) {
    return { ...parseCalendarDraft(input) }
  }
  if (capability === 'calendar.update') {
    keys(input, ['id', 'event'])
    return { id: text(input.id, 1024), event: parseCalendarDraft(input.event) }
  }
  if (capability === 'calendar.remove') {
    keys(input, ['id'])
    return { id: text(input.id, 1024) }
  }
  if (capability === 'calendar.list') {
    keys(input, ['from', 'to'])
    const from = instant(input.from)
    const to = instant(input.to)
    if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 366 * 86400_000) {
      return fail()
    }
    return { from, to }
  }
  if (capability === 'phone.dial') {
    keys(input, ['number'])
    const number = text(input.number, 40)!.replace(/[\s()-]/g, '')
    if (!/^\+?\d{3,20}$/.test(number)) {
      return fail()
    }
    return { number }
  }
  if (capability === 'share.present') {
    keys(input, ['title', 'text'])
    return { title: text(input.title, 200, true), text: text(input.text, 10000) }
  }
  keys(input, [])
  return {}
}
