import {
  CommonErrorCode,
  defineApiErrors,
  defineInternalErrors,
} from '@t-box/errors'

const apiErrors = defineApiErrors({
  CALENDAR_EVENT_NOT_FOUND: {
    statusCode: 404,
    message: '事件不存在或无权访问',
  },
  CALENDAR_LIMIT: {
    statusCode: 409,
    message: '事件数量超出当前应用容量',
  },
  CALENDAR_UNAVAILABLE: {
    statusCode: 503,
    message: '请登录后使用日历',
  },
  HOLIDAY_REVISION_CONFLICT: {
    statusCode: 409,
    message: '年度数据已更新，请刷新后再操作',
  },
  HOLIDAY_SOURCE_FAILED: {
    statusCode: 502,
    message: '节假日数据同步失败',
  },
  INVALID_KIND: {
    statusCode: 400,
    message: '事件类型无效',
  },
  INVALID_OCCURRENCE_STATE: {
    statusCode: 400,
    message: '事件状态无效',
  },
  INVALID_RANGE: {
    statusCode: 400,
    message: '查询范围需为 0 至 370 天',
  },
  INVALID_REVISION: {
    statusCode: 400,
    message: '版本号无效',
  },
  INVALID_SEARCH: {
    statusCode: 400,
    message: '搜索关键词最多 100 个字符',
  },
  INVALID_SETTINGS: {
    statusCode: 400,
    message: '同步配置无效',
  },
  INVALID_YEAR: {
    statusCode: 400,
    message: '数据年度与所选年度不一致',
  },
  OCCURRENCE_NOT_FOUND: {
    statusCode: 400,
    message: '此日期没有该事件',
  },
})
const internalErrors = defineInternalErrors('APPS_CALENDAR_SERVER', {
  INTERNAL_HOLIDAY_DATA_TOO_LARGE: '节假日数据超过大小限制',
  INTERNAL_INVALID_HOLIDAY_DAY: '节假日休班标记无效',
  INTERNAL_INVALID_HOLIDAY_SOURCE: '节假日数据源格式无效',
})

export const ErrorCode = Object.freeze({ ...CommonErrorCode, ...apiErrors, ...internalErrors })
