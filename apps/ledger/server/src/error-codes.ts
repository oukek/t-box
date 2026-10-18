import {
  CommonErrorCode,
  defineApiErrors,
} from '@t-box/errors'

const apiErrors = defineApiErrors({
  BATCH_SCOPE: {
    statusCode: 403,
    message: '批量操作不能跨账本或用户',
  },
  BILL_LINKED: {
    statusCode: 409,
    message: '账单存在退款或报销，不能直接修改财务内容',
  },
  BILL_NOT_FOUND: {
    statusCode: 404,
    message: '这条账单不存在或已被删除',
  },
  CATEGORY_ICON_NOT_FOUND: {
    statusCode: 404,
    message: '图标不存在或不属于当前账本',
  },
  CATEGORY_ICON_QUOTA: {
    statusCode: 409,
    message: '账本图标数量已达上限',
  },
  FEATURE_UNAVAILABLE: {
    statusCode: 503,
    message: '当前账本不支持此工具',
  },
  FORBIDDEN: {
    statusCode: 403,
    message: '仅账本所有者或管理员可管理此设置',
  },
  IMPORT_DUPLICATE: {
    statusCode: 409,
    message: '导入内容包含重复记录',
  },
  INVALID_CATEGORY_ICON: {
    statusCode: 400,
    message: '图标图片编码无效',
  },
  INVITE_NOT_FOUND: {
    statusCode: 404,
    message: '邀请不存在',
  },
  LEDGER_ARCHIVED: {
    statusCode: 409,
    message: '账本已归档，仅可查看',
  },
  LEDGER_LOCKED: {
    statusCode: 423,
    message: '请先输入账本密码解锁',
  },
  LEDGER_NOT_FOUND: {
    statusCode: 404,
    message: '账本不存在或你已不再是成员',
  },
  LEDGER_REQUIRED: {
    statusCode: 409,
    message: '请先到应用页打开并解锁要操作的账本，再继续此操作。',
  },
  MEMBER_NOT_FOUND: {
    statusCode: 404,
    message: '成员不存在',
  },
  OVER_SETTLEMENT: {
    statusCode: 409,
    message: '收还款超过剩余金额，请刷新往来余额',
  },
  PASSWORD_INCORRECT: {
    statusCode: 403,
    message: '账本密码不正确',
  },
  PRESET_LABEL_CONFLICT: {
    statusCode: 409,
    message: '同一收支类型已存在此系统分类名称',
  },
  PRESET_NOT_FOUND: {
    statusCode: 404,
    message: '系统分类不存在',
  },
  PRESET_REVISION_CONFLICT: {
    statusCode: 409,
    message: '分类已被其他管理员修改，请刷新后重试',
  },
  RECORD_NOT_FOUND: {
    statusCode: 404,
    message: '记录不存在或不可访问',
  },
  REQUEST_CONFLICT: {
    statusCode: 409,
    message: '同一操作标识不能用于不同内容',
  },
  RESOURCE_AMBIGUOUS: {
    statusCode: 409,
    message: '请明确选择一个目标账本',
  },
  SYSTEM_CATEGORY_READ_ONLY: {
    statusCode: 403,
    message: '系统分类由管理后台维护，账本内不可修改、删除或合并',
  },
  UNAVAILABLE: {
    statusCode: 503,
    message: '往来未启用',
  },
})

export const ErrorCode = Object.freeze({ ...CommonErrorCode, ...apiErrors })
