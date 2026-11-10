/** Navigation only: notifications never carry executable commands or arbitrary URLs. */
export type NotificationTarget =
  | { type: 'application', appId: string, params: Record<string, string> } |
  { type: 'task', taskId: string } |
  { type: 'system', page: 'resources' | 'wallet' | 'memory' | 'settings' }

export interface NotificationAction {
  label: string
  target: NotificationTarget
}
export interface NotificationContent {
  style: 'info' | 'success' | 'warning' | 'action' | 'image'
  title: string
  body?: string
  imageResourceId?: string
  actions: NotificationAction[]
}
export interface SystemNotification extends NotificationContent {
  id: string
  sourceAppId: string
  kind: string
  taskId?: string
  read: boolean
  readAt: string | null
  createdAt: string
}
export interface NotificationInbox {
  unread: number
  items: SystemNotification[]
  nextCursor: string | null
}

const identifier = /^[a-z][a-z0-9_-]{0,63}$/
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('通知格式不正确')
  }
  return value as Record<string, unknown>
}
function text(value: unknown, limit: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new TypeError('通知文字长度不正确')
  }
  return value.trim()
}
export function parseNotificationTarget(value: unknown): NotificationTarget {
  const target = record(value)
  if (target.type === 'application' && typeof target.appId === 'string' && identifier.test(target.appId)) {
    const params = record(target.params ?? {})
    if (Object.keys(target).some((key) => !['type', 'appId', 'params'].includes(key)) || Object.keys(params).length > 20 || Object.entries(params).some(([key, value]) => !/^\w{1,40}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || typeof value !== 'string' || value.length > 2000)) {
      throw new TypeError('通知页面参数不正确')
    }
    return { type: 'application', appId: target.appId, params: { ...params } as Record<string, string> }
  }
  if (target.type === 'task' && typeof target.taskId === 'string' && uuid.test(target.taskId) && Object.keys(target).every((key) => ['type', 'taskId'].includes(key))) {
    return { type: 'task', taskId: target.taskId }
  }
  if (target.type === 'system' && ['resources', 'wallet', 'memory', 'settings'].includes(String(target.page)) && Object.keys(target).every((key) => ['type', 'page'].includes(key))) {
    return { type: 'system', page: target.page as 'resources' | 'wallet' | 'memory' | 'settings' }
  }
  throw new TypeError('通知跳转目标不正确')
}
export function parseNotificationContent(value: unknown): NotificationContent {
  const input = record(value)
  if (Object.keys(input).some((key) => !['style', 'title', 'body', 'actions', 'imageResourceId'].includes(key)) || !['info', 'success', 'warning', 'action', 'image'].includes(String(input.style)) || !Array.isArray(input.actions) || input.actions.length > 3) {
    throw new TypeError('通知内容不正确')
  }
  if (input.imageResourceId !== undefined && (typeof input.imageResourceId !== 'string' || !uuid.test(input.imageResourceId))) {
    throw new TypeError('通知图片不正确')
  }
  if (input.style === 'image' && !input.imageResourceId) {
    throw new TypeError('图片通知缺少图片')
  }
  return {
    style: input.style as NotificationContent['style'],
    title: text(input.title, 100),
    ...(input.body === undefined ? {} : { body: text(input.body, 1000) }),
    ...(input.imageResourceId ? { imageResourceId: input.imageResourceId as string } : {}),
    actions: input.actions.map((value) => {
      const action = record(value)
      if (Object.keys(action).some((key) => !['label', 'target'].includes(key))) {
        throw new TypeError('通知操作不正确')
      }
      return { label: text(action.label, 24), target: parseNotificationTarget(action.target) }
    }),
  }
}
