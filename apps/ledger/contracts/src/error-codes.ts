import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('APPS_LEDGER_CONTRACTS', {
  INTERNAL_REMOTE_OPERATION_FAILED: '远程操作失败',
  INTERNAL_INVALID_BILL_MONTH: '账单月份无效',
  INTERNAL_INVALID_INVITATION_TOKEN: '邀请口令无效',
  INTERNAL_INVALID_LEDGER_NAVIGATION: '记账页面参数无效',
  INTERNAL_INVALID_LEDGER_RESOURCE_ID: '账本或账单标识无效',
  INTERNAL_UNSUPPORTED_LEDGER_NAVIGATION: '记账页面包含未支持的参数',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
