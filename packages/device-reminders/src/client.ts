import type { AppClient } from '@t-box/app-sdk'
import { reactive } from 'vue'

export const reminderStatus = reactive({ state: 'foreground', scheduled: 0, truncated: false, exact: false, error: '', platform: 'web' })
let client: AppClient | undefined
export function configureReminderClient(value: AppClient) {
  client = value
}
async function action(name: 'status' | 'sync' | 'enable' | 'exact') {
  if (!client) {
    throw new Error('提醒服务尚未连接')
  }
  try {
    const snapshot = await client.device.reminders<typeof reminderStatus & { result?: unknown }>(name)
    const { result, ...status } = snapshot
    Object.assign(reminderStatus, status)
    return result
  } catch (error) {
    reminderStatus.error = error instanceof Error ? error.message : '提醒同步失败'
    return { synced: false, state: 'sync_failed' }
  }
}
export const refreshReminderStatus = () => action('status')
export const syncDeviceReminders = (_force = false) => action('sync')
export const enableDeviceReminders = () => action('enable')
export const requestExactAlarms = () => action('exact')
