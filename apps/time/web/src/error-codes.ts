import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('APPS_TIME_WEB', {
  INTERNAL_HOST_NOT_CONNECTED: '应用尚未连接宿主',
  INTERNAL_INVALID_REMINDER_PLAN: '提醒同步参数无效',
  INTERNAL_TIMEZONE_EXISTS: '此时区已添加',
  INTERNAL_WORLD_CLOCK_LIMIT: '最多添加 12 个世界时钟',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
