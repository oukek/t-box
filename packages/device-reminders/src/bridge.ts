import { Capacitor } from '@capacitor/core'
import {
  enableDeviceReminders,
  reminderStatus,
  requestExactAlarms,
  syncDeviceReminders,
} from './deviceReminders'
import { ErrorCode } from './error-codes.js'

export async function reminderHostAction(action: unknown) {
  if (
    typeof action !== 'string' ||
    !['status', 'sync', 'enable', 'exact'].includes(action)
  ) {
    throw ErrorCode.INTERNAL_INVALID_REMINDER_ACTION()
  }
  let result: unknown
  if (action === 'sync') {
    result = await syncDeviceReminders(true)
  }
  if (action === 'enable') {
    result = await enableDeviceReminders()
  }
  if (action === 'exact') {
    await requestExactAlarms()
  }
  return { ...reminderStatus, platform: Capacitor.getPlatform(), result }
}
