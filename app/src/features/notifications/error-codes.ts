import { defineInternalErrors } from '@t-box/errors'

export const ErrorCode = defineInternalErrors('APP_NOTIFICATIONS', {
  INTERNAL_LOGIN_REQUIRED: '请先登录再查看通知',
  INTERNAL_TARGET_UNAVAILABLE: '任务已删除或当前不可访问',
  INTERNAL_CONVERSATION_BUSY: '当前对话正在处理，请稍后再打开此任务',
})
