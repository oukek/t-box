import type { NotificationTarget } from '@t-box/app-contracts'
import type { TaskSummary } from '@t-box/shared'
import { parseNotificationTarget } from '@t-box/app-contracts'
import { authorizeResources } from '../../applications/registry'
import { navigateTab, openApplication, openMemory, openProfile, openResources, openWallet } from '../../core/navigation'
import { request } from '../../core/network'
import { identity } from '../../core/session'
import { openConversation } from '../chat/chatStore'
import { ErrorCode } from './error-codes'

export async function openNotificationTarget(value: NotificationTarget) {
  const target = parseNotificationTarget(value)
  const user = identity.user?.id
  if (!user) {
    throw ErrorCode.INTERNAL_LOGIN_REQUIRED()
  }
  if (target.type === 'application') {
    await openApplication({ appId: target.appId, params: target.params })
  } else if (target.type === 'system') {
    const actions = { resources: openResources, wallet: openWallet, memory: openMemory, settings: openProfile }
    await actions[target.page]()
  } else {
    const { data: task } = await request<{ data: TaskSummary }>(`/tasks/${encodeURIComponent(target.taskId)}/reference`)
    if (identity.user?.id !== user) {
      return false
    }
    if (!task || task.unavailable) {
      throw ErrorCode.INTERNAL_TARGET_UNAVAILABLE()
    }
    if (!await authorizeResources(task.protectedResources || [], '查看通知关联任务')) {
      return false
    }
    await request(`/tasks/${encodeURIComponent(task.id)}`)
    if (identity.user?.id !== user) {
      return false
    }
    if (!openConversation(task.conversationId)) {
      throw ErrorCode.INTERNAL_CONVERSATION_BUSY()
    }
    navigateTab('home')
  }
  return true
}
