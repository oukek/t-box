import { DateTimeError } from './date-time-error.js'

export const DateTimeErrorCode = Object.freeze({
  INVALID_DATETIME: (message = '日期时间参数无效') =>
    new DateTimeError(message),
})
