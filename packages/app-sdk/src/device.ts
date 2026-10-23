import type { DeviceCalendarDraft, DeviceCapability, DeviceEnvironment, DeviceInputs, DeviceResults, HostMethod } from '@t-box/app-contracts'
import type { RequestOptions } from './index.js'

export function createDeviceClient(call: <T>(method: HostMethod, args: unknown, options?: RequestOptions) => Promise<T>) {
  function invoke<K extends DeviceCapability>(capability: K, args: DeviceInputs[K], options?: RequestOptions) {
    return call<DeviceResults[K]>('device.invoke', { capability, arguments: args }, { timeoutMs: 120_000, ...options })
  }
  return {
    getCapabilities: () => call<DeviceEnvironment>('device.capabilities', {}),
    permissions: {
      request: (capabilities: DeviceCapability[]) => call<DeviceEnvironment>('device.permissions.request', { capabilities }, { timeoutMs: 120_000 }),
      revoke: (capabilities: DeviceCapability[]) => call<DeviceEnvironment>('device.permissions.revoke', { capabilities }),
    },
    phone: { dial: (args: DeviceInputs['phone.dial']) => invoke('phone.dial', args) },
    calendar: {
      presentCreate: (event: DeviceCalendarDraft, options?: RequestOptions) => invoke('calendar.presentCreate', event, options),
      create: (event: DeviceCalendarDraft, options: RequestOptions) => invoke('calendar.create', event, options),
      list: (range: DeviceInputs['calendar.list']) => invoke('calendar.list', range),
      update: (args: DeviceInputs['calendar.update'], options: RequestOptions) => invoke('calendar.update', args, options),
      remove: (args: DeviceInputs['calendar.remove'], options: RequestOptions) => invoke('calendar.remove', args, options),
    },
    share: { present: (args: DeviceInputs['share.present']) => invoke('share.present', args) },
    system: { openSettings: () => invoke('system.openSettings', {}) },
  }
}
