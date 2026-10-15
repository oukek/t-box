import { Capacitor } from '@capacitor/core'
import { enableDeviceReminders, reminderStatus, requestExactAlarms, syncDeviceReminders } from './deviceReminders'

export async function reminderHostAction(action: unknown) {
  if (typeof action !== 'string' || !['status', 'sync', 'enable', 'exact'].includes(action)) {
    throw new Error('提醒操作无效')
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
