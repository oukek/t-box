import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('APPS_LEDGER_WEB', {
  INTERNAL_AUTHORIZATION_UNAVAILABLE: '已有授权等待处理或授权信息无效',
  INTERNAL_CONFIRMATION_PENDING: '已有一项操作等待确认。',
  INTERNAL_CONFIRMATION_SCOPE_CHANGED: '确认内容无效或账本已切换。',
  INTERNAL_CROSS_APPLICATION_NAVIGATION_DENIED: '不支持跨应用导航',
  INTERNAL_CSV_HEADER_REQUIRED: '文件没有表头',
  INTERNAL_DEBT_SELECTION_REQUIRED: '至少选择一笔往来',
  INTERNAL_HOST_NOT_CONNECTED: '记账应用尚未连接宿主',
  INTERNAL_IMAGE_READ_FAILED: '图片无法读取，请选择其他图片',
  INTERNAL_INVALID_ALLOCATION_AMOUNT: '每笔分配金额须大于零且最多两位小数',
  INTERNAL_INVALID_AMOUNT: '金额须大于零且最多两位小数',
  INTERNAL_INVALID_AUTHORIZATION_SCOPE: '授权范围无效',
  INTERNAL_INVALID_CONFIRMATION_CONTENT: '确认内容无效。',
  INTERNAL_INVALID_ICON_IMAGE: '请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片',
  INTERNAL_INVALID_LEDGER_ID: '账本标识无效',
  INTERNAL_LEDGER_ACCESS_DENIED: '无权访问该账本',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
