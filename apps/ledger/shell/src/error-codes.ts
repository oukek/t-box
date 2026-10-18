import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('APPS_LEDGER_SHELL', {
  INTERNAL_INVALID_LEDGER_EVENT: '账本事件参数无效',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
