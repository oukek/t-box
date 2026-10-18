import {
  CommonErrorCode,
  defineApiErrors,
} from '@t-box/errors'

const apiErrors = defineApiErrors({
  IMAGE_REFERENCE_REQUIRED: {
    statusCode: 400,
    message: '只能编辑本会话附加或生成的图片，请先附加所需图片',
  },
})

export const ErrorCode = Object.freeze({ ...CommonErrorCode, ...apiErrors })
