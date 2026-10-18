import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('PACKAGES_DEVICE_REMINDERS', {
  INTERNAL_INVALID_REMINDER_ACTION: '提醒操作无效',
  INTERNAL_INVALID_REMINDER_PLAN: '提醒同步参数无效',
  INTERNAL_REMINDER_NOT_CONNECTED: '提醒服务尚未连接',
  INTERNAL_REMINDER_SERVICE_UNAVAILABLE: '提醒服务暂不可用，已保留上次计划',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
