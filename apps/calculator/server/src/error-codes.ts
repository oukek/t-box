import {
  defineApiErrors,
} from '@t-box/errors'

const apiErrors = defineApiErrors({
  INVALID_CALCULATION: {
    statusCode: 400,
    message: '计算参数无效',
  },
})

export const ErrorCode = Object.freeze({ ...apiErrors })
