import {
  CommonErrorCode,
  defineApiErrors,
  defineInternalErrors,
} from '@t-box/errors'

const apiErrors = defineApiErrors({
  INVALID_DATETIME: {
    statusCode: 400,
    message: '日期时间参数无效',
  },
  REVISION_REQUIRED: {
    statusCode: 400,
    message: '请提供有效的数据版本',
  },
  UNAUTHORIZED: {
    statusCode: 401,
    message: '账号不可用',
  },
})

export const ErrorCode = Object.freeze({
  ...CommonErrorCode,
  ...apiErrors,
  ...defineInternalErrors('PERSISTENCE', {
    INVALID_JSON_DOCUMENT: '无法保存非 JSON 数据',
  }),
})
