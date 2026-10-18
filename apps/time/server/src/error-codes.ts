import {
  CommonErrorCode,
  defineApiErrors,
} from '@t-box/errors'

const apiErrors = defineApiErrors({
  INVALID_TIMER: {
    statusCode: 400,
    message: '名称最多 100 字，时长为 1 秒至 7 天的整数秒',
  },
  INVALID_TIMER_ACTION: {
    statusCode: 400,
    message: '倒计时操作无效',
  },
  TIME_UNAVAILABLE: {
    statusCode: 503,
    message: '请登录后使用时间应用',
  },
  TIMER_LIMIT: {
    statusCode: 409,
    message: '最多保留 50 个倒计时，请整理已结束的记录',
  },
  TIMER_NOT_FOUND: {
    statusCode: 404,
    message: '倒计时不存在或无权访问',
  },
})

export const ErrorCode = Object.freeze({ ...CommonErrorCode, ...apiErrors })
