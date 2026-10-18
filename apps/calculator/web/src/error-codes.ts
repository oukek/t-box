import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('APPS_CALCULATOR_WEB', {
  INTERNAL_EXPRESSION_REQUIRED: '请输入表达式',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
