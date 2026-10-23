export const DEVICE_PROTOCOL_VERSION = 1 as const
export const deviceCapabilities = ['phone.dial', 'calendar.presentCreate', 'calendar.create', 'calendar.list', 'calendar.update', 'calendar.remove', 'share.present', 'system.openSettings'] as const
export type DeviceCapability = typeof deviceCapabilities[number]
export type DevicePermission = 'prompt' | 'granted' | 'denied' | 'restricted' | 'unavailable'
export interface DeviceCapabilityStatus {
  capability: DeviceCapability
  supported: boolean
  declared: boolean
  authorized: boolean
}
export interface DeviceEnvironment {
  protocol: typeof DEVICE_PROTOCOL_VERSION
  platform: 'web' | 'ios' | 'android'
  capabilities: DeviceCapabilityStatus[]
}
export interface DeviceCalendarDraft {
  title: string
  startAt: string
  endAt: string
  timeZone?: string
  allDay?: boolean
  location?: string
  notes?: string
  reminderMinutes?: number[]
}
export interface DeviceCalendarEvent extends DeviceCalendarDraft { id: string }
export interface DeviceInputs {
  'phone.dial': { number: string }
  'calendar.presentCreate': DeviceCalendarDraft
  'calendar.create': DeviceCalendarDraft
  'calendar.list': { from: string, to: string }
  'calendar.update': { id: string, event: DeviceCalendarDraft }
  'calendar.remove': { id: string }
  'share.present': { title?: string, text: string }
  'system.openSettings': Record<string, never>
}
export interface DeviceResults {
  'phone.dial': { status: 'handed_off' }
  'calendar.presentCreate': { status: 'saved' | 'cancelled', id?: string }
  'calendar.create': { status: 'saved', id: string }
  'calendar.list': { events: DeviceCalendarEvent[], truncated: boolean }
  'calendar.update': { status: 'saved', id: string }
  'calendar.remove': { status: 'removed' }
  'share.present': { status: 'shared' | 'cancelled' }
  'system.openSettings': { status: 'handed_off' }
}
export const deviceCapabilityLabels: Readonly<Record<DeviceCapability, string>> = {
  'phone.dial': '调起拨号',
  'calendar.presentCreate': '添加到系统日历',
  'calendar.create': '直接添加系统日历事件',
  'calendar.list': '读取系统日历',
  'calendar.update': '修改系统日历事件',
  'calendar.remove': '删除系统日历事件',
  'share.present': '打开系统分享',
  'system.openSettings': '打开系统设置',
}
