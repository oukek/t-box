import type { AppTimer, ReminderItem } from '@t-box/shared'
import type { ReminderPlan } from './planner'
import { Capacitor } from '@capacitor/core'
import { identity, request } from '@t-box/app-shell-sdk'
import { reactive, ref, watch } from 'vue'
import { mergeReminderSources, planReminders } from './planner'

export const reminderStatus = reactive({
  state: 'foreground' as 'foreground' | 'granted' | 'denied' | 'unavailable',
  scheduled: 0,
  truncated: false,
  exact: false,
  error: '',
})
export const dueReminder = ref<ReminderItem | null>(null)
let owner = ''
let items: ReminderItem[] = []
let version = 0
let inflight: Promise<SyncResult> | undefined
let queue = Promise.resolve()
let serverOffset = 0
const planKey = 'tbox.reminders.plan.v2'
const seen = new Set<string>()
const native = () => Capacitor.isNativePlatform()
function loadPlan(): ReminderPlan {
  try {
    const p = JSON.parse(localStorage.getItem(planKey) || 'null')
    if (p && typeof p.owner === 'string' && Array.isArray(p.notifications)) {
      return p
    }
  } catch {}
  return { owner: '', notifications: [] }
}
let memoryPlan = loadPlan()
function readPlan() {
  return memoryPlan
}
function storePlan(plan: ReminderPlan) {
  memoryPlan = plan
  try {
    localStorage.setItem(planKey, JSON.stringify(plan))
  } catch {}
}
async function plugin() {
  return (await import('@capacitor/local-notifications')).LocalNotifications
}
async function clearNative() {
  if (!native()) {
    return
  }
  const plan = readPlan()
  if (plan.notifications.length) {
    await (
      await plugin()
    ).cancel({ notifications: plan.notifications.map((n) => ({ id: n.id })) })
  }
  storePlan({ owner: '', notifications: [] })
}
function serial(run: () => Promise<void>) {
  const result = queue.then(run, run)
  queue = result.catch(() => {})
  return result
}
watch(
  () => identity.user?.id,
  (id, previous) => {
    version++
    owner = id ?? ''
    inflight = undefined
    items = []
    seen.clear()
    dueReminder.value = null
    reminderStatus.scheduled = 0
    reminderStatus.error = ''
    try {
      for (const key of JSON.parse(
        localStorage.getItem(`tbox.reminders.seen:${owner}`) || '[]',
      )) {
        if (typeof key === 'string') {
          seen.add(key)
        }
      }
    } catch {}
    // Preserve this account's pending system alarms on a cold launch, including offline launches.
    if (
      (!id && previous) ||
      (id && readPlan().owner && readPlan().owner !== id)
    ) {
      void serial(clearNative).catch(() => {
        reminderStatus.error = '旧设备提醒取消失败，请检查通知设置'
      })
    }
  },
  { flush: 'sync' },
)
export async function enableDeviceReminders() {
  if (!native()) {
    reminderStatus.state = 'foreground'
    return syncDeviceReminders(true)
  }
  try {
    const permission = await (await plugin()).requestPermissions()
    reminderStatus.state =
      permission.display === 'granted' ? 'granted' : 'denied'
    if (permission.display === 'granted') {
      return syncDeviceReminders(true)
    }
  } catch (error) {
    reminderStatus.state = 'unavailable'
    reminderStatus.error =
      error instanceof Error ? error.message : '申请提醒权限失败'
  }
  return { synced: false, state: reminderStatus.state }
}
interface SyncResult {
  synced: boolean
  state: string
  scheduled: number
  truncated: boolean
}
const failed = (state: string): SyncResult => ({
  synced: false,
  state,
  scheduled: 0,
  truncated: false,
})
export async function syncDeviceReminders(force = false): Promise<SyncResult> {
  if (inflight) {
    if (!force) {
      return inflight
    }
    const uid = identity.user?.id
    await inflight
    if (identity.user?.id !== uid) {
      return failed('account_changed')
    }
    return syncDeviceReminders(true)
  }
  const uid = identity.user?.id
  const revision = version
  if (!uid) {
    return failed('signed_out')
  }
  owner = uid
  const task = (async () => {
    const timezone =
      new Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
    const [calendar, time] = await Promise.allSettled([
      request<{
        data: {
          reminders: ReminderItem[]
          serverNow: string
          truncated: boolean
        }
      }>(`/calendar/reminders?timezone=${encodeURIComponent(timezone)}`),
      request<{ data: { timers: AppTimer[], serverNow: string } }>(
        '/time/timers',
      ),
    ])
    if (identity.user?.id !== uid || version !== revision) {
      return failed('account_changed')
    }
    if (calendar.status === 'rejected' && time.status === 'rejected') {
      throw new Error('提醒服务暂不可用，已保留上次计划')
    }
    const syncError = calendar.status === 'rejected' || time.status === 'rejected' ? '部分提醒同步失败，已保留上次计划' : ''
    const serverNow = time.status === 'fulfilled' ? time.value.data.serverNow : calendar.status === 'fulfilled' ? calendar.value.data.serverNow : ''
    serverOffset = Date.parse(serverNow) - Date.now()
    const now = Date.now() + serverOffset
    const timers: ReminderItem[] | null = time.status === 'fulfilled'
      ? time.value.data.timers
          .filter((t) => t.deadline && ['running', 'completed'].includes(t.status))
          .map((t) => ({
            key: `time:${t.id}:${t.deadline}`,
            title: t.label,
            body: '倒计时已结束',
            at: t.deadline!,
            destination: { appId: 'time', params: { tab: 'timers' } },
          }))
      : null
    items = mergeReminderSources(uid, [
      { appId: 'calendar', items: calendar.status === 'fulfilled' ? calendar.value.data.reminders : null },
      { appId: 'time', items: timers },
    ], items, readPlan())
    if (calendar.status === 'fulfilled') {
      reminderStatus.truncated = calendar.value.data.truncated
    }
    if (!native()) {
      reminderStatus.state = 'foreground'
      reminderStatus.error = syncError
      return {
        synced: !syncError,
        state: syncError ? 'partial' : 'foreground_only',
        scheduled: 0,
        truncated: reminderStatus.truncated,
      }
    }
    const api = await plugin()
    const permissions = await api.checkPermissions()
    reminderStatus.state =
      permissions.display === 'granted' ? 'granted' : 'denied'
    if (permissions.display !== 'granted') {
      return failed('permission_required')
    }
    await serial(async () => {
      if (identity.user?.id !== uid || version !== revision) {
        return
      }
      const pending = await api.getPending()
      const diff = planReminders(
        uid,
        items,
        readPlan(),
        pending.notifications.map((n) => n.id),
        now,
      )
      if (diff.cancel.length) {
        await api.cancel({ notifications: diff.cancel.map((id) => ({ id })) })
      }
      // Persist before scheduling so partial failures remain recoverable on the next refresh.
      storePlan(diff.plan)
      if (diff.schedule.length) {
        await api.schedule({
          notifications: diff.schedule.map((n) => ({
            id: n.id,
            title: n.title,
            body: n.body,
            schedule: { at: new Date(Date.parse(n.at) - serverOffset) },
            extra: { owner: uid, destination: n.destination },
          })),
        })
      }
      if (identity.user?.id !== uid || version !== revision) {
        await clearNative()
        return
      }
      reminderStatus.scheduled = diff.plan.notifications.length
      reminderStatus.truncated ||= diff.truncated
      reminderStatus.error = syncError
      if (Capacitor.getPlatform() === 'android') {
        try {
          reminderStatus.exact =
            (await api.checkExactNotificationSetting()).exact_alarm ===
            'granted'
        } catch {
          reminderStatus.exact = false
        }
      }
    })
    if (identity.user?.id !== uid || version !== revision) {
      return failed('account_changed')
    }
    return {
      synced: !syncError,
      state: syncError ? 'partial' : reminderStatus.state,
      scheduled: reminderStatus.scheduled,
      truncated: reminderStatus.truncated,
    }
  })().catch((error) => {
    if (identity.user?.id === uid) {
      reminderStatus.error =
        error instanceof Error ? error.message : '提醒同步失败'
    }
    return failed('sync_failed')
  })
  inflight = task
  try {
    return await task
  } finally {
    if (inflight === task) {
      inflight = undefined
    }
  }
}
export function checkDueReminders() {
  const now = Date.now() + serverOffset
  if (!owner || owner !== identity.user?.id) {
    return
  }
  for (const item of items) {
    const at = Date.parse(item.at)
    if (at <= now && now - at < 10 * 60000 && !seen.has(item.key)) {
      seen.add(item.key)
      dueReminder.value = item
    }
  }
  try {
    localStorage.setItem(
      `tbox.reminders.seen:${owner}`,
      JSON.stringify([...seen].slice(-100)),
    )
  } catch {}
}
export function validateSyncArguments(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length
  ) {
    throw new Error('提醒同步参数无效')
  }
  return syncDeviceReminders(true)
}
export async function requestExactAlarms() {
  if (!native() || Capacitor.getPlatform() !== 'android') {
    return
  }
  await (await plugin()).changeExactNotificationSetting()
}
