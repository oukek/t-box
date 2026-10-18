import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('APPS_CALENDAR_WEB', {
  INTERNAL_BACKUP_FILE_TOO_LARGE: '备份文件最多 5 MB',
  INTERNAL_CONFIRMATION_PENDING: '已有确认待处理',
  INTERNAL_HOST_NOT_CONNECTED: '应用尚未连接宿主',
  INTERNAL_INVALID_CALENDAR_BACKUP: '请选择 T Box 日历备份，每次最多 1000 条',
  INTERNAL_INVALID_CONFIRMATION_ARGUMENTS: '确认参数无效',
  INTERNAL_INVALID_CONFIRMATION_CONTENT: '确认内容无效',
  INTERNAL_INVALID_HOLIDAY_YEAR: '节假日年度数据格式无效',
  INTERNAL_INVALID_REMINDER_PLAN: '提醒同步参数无效',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
