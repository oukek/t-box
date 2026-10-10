import type { ApplicationId, ChatClientEvent, ChatMessage, ChatMode, ChatRun, ChatServerEvent, ChatSnapshot, Resource, ResourceRef, TaskSummary, ToolResult } from '@t-box/shared'
import {
  CHAT_LIMITS,
} from '@t-box/shared'
import { computed, reactive, readonly } from 'vue'
import {
  authorizeResources,
  cancelClientInteractions,
  currentScopeBindings,
} from '../../applications/registry'
import { clientCapabilities, executeClientTool } from '../../core/clientTools'
import { createRequestId } from '../../core/identifiers'
import { apiBase, chatWebSocketUrl } from '../../core/network'
import { identity } from '../../core/session'
import { taskBlocksNewMessage } from './messagePolicy'
import { ClientTaskRecovery } from './taskRecovery'
import { applyTimelineDelta, applyTimelineItem } from './timelineReducer'

export interface ChatDraft {
  requestId: string
  text: string
  attachments: Resource[]
  applicationIds: ApplicationId[]
  sourceMessageId?: string
  expectedRevision?: number
}
let pendingDraft: ChatDraft | null = null
const messageMutations = new Map<
  string,
  {
    resolve: () => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
>()
type Connection = 'connecting' | 'restoring' | 'connected' | 'offline'
const state = reactive({
  maxMessageLength: CHAT_LIMITS.maxMessageLength as number,
  connection: 'connecting' as Connection,
  mode: null as ChatMode | null,
  sessionId: '',
  conversationId: '',
  title: '',
  conversationRevision: undefined as number | undefined,
  branch: undefined as ChatSnapshot['branch'],
  mutationRequestId: '',
  retryRequestId: '',
  messages: [] as ChatMessage[],
  activeRun: null as ChatRun | null,
  task: null as TaskSummary | null,
  pendingText: '',
  cancelling: false,
  error: '',
  errorCode: '',
  outcomeUncertain: false,
  storageNotice: '',
  failedDraft: null as ChatDraft | null,
})
function rejectMutations(message: string) {
  for (const mutation of messageMutations.values()) {
    clearTimeout(mutation.timer)
    mutation.reject(new Error(message))
  }
  messageMutations.clear()
  state.mutationRequestId = ''
}
const storageKey = () =>
  `t-box.chat.session.v2:${apiBase}:${identity.user?.id}`
let sessionToken = ''
let socket: WebSocket | null = null
let started = false
let generation = 0
let retries = 0
let reconnectBlocked = false
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let handshakeTimer: ReturnType<typeof setTimeout> | undefined
let acceptanceTimer: ReturnType<typeof setTimeout> | undefined
let heartbeatTimer: ReturnType<typeof setInterval> | undefined
let lastReceivedAt = 0
const toolResults = new Map<string, Promise<ToolResult>>()
const taskRecovery = new ClientTaskRecovery()
let pendingAuthorization: ResourceRef[] = []

export const chatState = readonly(state)
export const chatBusy = computed(() =>
  Boolean(
    state.activeRun ||
    state.pendingText ||
    state.mutationRequestId ||
    state.retryRequestId,
  ),
)
export const canSendMessage = computed(
  () =>
    state.connection === 'connected' &&
    state.mode === 'openai' &&
    !chatBusy.value &&
    !taskBlocksNewMessage(state.task),
)

function readSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey()) || 'null') as {
      sessionId?: unknown
      token?: unknown
      conversationId?: unknown
    } | null
    if (
      typeof stored?.sessionId === 'string' &&
      typeof stored.token === 'string'
    ) {
      state.sessionId = stored.sessionId
      sessionToken = stored.token
      state.conversationId =
        typeof stored.conversationId === 'string' ? stored.conversationId : ''
    }
  } catch {
    state.storageNotice = '当前环境无法保存会话，关闭页面后可能无法恢复对话。'
  }
}

function persistSession() {
  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify({
        sessionId: state.sessionId,
        token: sessionToken,
        conversationId: state.conversationId,
      }),
    )
  } catch {
    state.storageNotice = '当前环境无法保存会话，关闭页面后可能无法恢复对话。'
  }
}

function applySnapshot(snapshot: ChatSnapshot) {
  state.sessionId = snapshot.sessionId
  state.conversationId = snapshot.conversationId || ''
  state.title = snapshot.title || ''
  state.conversationRevision = snapshot.conversationRevision
  state.branch = snapshot.branch
  state.mode = snapshot.mode
  state.messages = snapshot.messages
  state.activeRun = snapshot.activeRun
  state.task = snapshot.task || null
  if (!snapshot.activeRun) {
    state.cancelling = false
  }
}

function transmit(event: ChatClientEvent): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false
  }
  try {
    socket.send(JSON.stringify(event))
    return true
  } catch {
    return false
  }
}

function clearTimers() {
  clearTimeout(reconnectTimer)
  clearTimeout(handshakeTimer)
  clearTimeout(acceptanceTimer)
  clearInterval(heartbeatTimer)
}

function upsert(message: ChatMessage) {
  const index = state.messages.findIndex((item) => item.id === message.id)
  if (index < 0) {
    state.messages.push(message)
  } else {
    state.messages[index] = message
  }
}

async function handleClientTool(
  event: Extract<ChatServerEvent, { type: 'tool.request' }>,
  currentGeneration: number,
) {
  if (!state.activeRun || state.activeRun.id !== event.runId) {
    return
  }
  const key = `${event.runId}:${event.callId}`
  let execution = toolResults.get(key)
  if (!execution) {
    execution = executeClientTool(event.name, event.arguments)
    toolResults.set(key, execution)
  }
  const result = await execution
  if (
    currentGeneration === generation &&
    state.activeRun?.id === event.runId &&
    state.connection === 'connected'
  ) {
    if (
      !transmit({
        type: 'tool.result',
        runId: event.runId,
        callId: event.callId,
        result,
      })
    ) {
      state.outcomeUncertain = true
    }
  }
}

function receive(event: ChatServerEvent, currentGeneration: number) {
  switch (event.type) {
    case 'runtime.configuration':
      state.maxMessageLength = event.maxMessageLength
      break
    case 'session.ready': {
      // A branch switch is an acknowledgement on the current live socket, not a reconnect handshake.
      const branchSwitch = Boolean(
        state.connection === 'connected' &&
        pendingDraft?.sourceMessageId &&
        !event.restored &&
        event.snapshot.branch?.sourceMessageId ===
        pendingDraft.sourceMessageId &&
        event.snapshot.conversationId !== state.conversationId,
      )
      const interrupted =
        state.outcomeUncertain || Boolean(state.activeRun || state.pendingText)
      clearTimeout(handshakeTimer)
      if (!branchSwitch) {
        clearTimeout(acceptanceTimer)
      }
      applySnapshot(event.snapshot)
      state.retryRequestId = ''
      taskRecovery.open(event.snapshot)
      sessionToken = event.token
      persistSession()
      state.pendingText = branchSwitch ? pendingDraft!.text : ''
      if (!branchSwitch) {
        pendingDraft = null
      }
      state.connection = 'connected'
      state.outcomeUncertain = !branchSwitch && !event.restored && interrupted
      state.error = ''
      state.errorCode = ''
      retries = 0
      break
    }
    case 'message.deleted': {
      applySnapshot(event.snapshot)
      persistSession()
      const mutation = messageMutations.get(event.requestId)
      if (mutation) {
        clearTimeout(mutation.timer)
        messageMutations.delete(event.requestId)
        state.mutationRequestId = ''
        mutation.resolve()
      }
      taskRecovery.clear()
      break
    }
    case 'session.snapshot':
      applySnapshot(event.snapshot)
      persistSession()
      break
    case 'agent.changed':
      if (state.activeRun?.id === event.runId) {
        state.activeRun.agentId = event.agentId
        state.activeRun.agentTitle = event.title
      }
      break
    case 'run.started':
      if (state.retryRequestId === event.run.requestId) {
        state.retryRequestId = ''
      }
      if (pendingDraft?.requestId === event.run.requestId) {
        pendingDraft = null
      }
      clearTimeout(acceptanceTimer)
      state.pendingText = ''
      state.error = ''
      state.outcomeUncertain = false
      state.activeRun = event.run
      upsert(event.userMessage)
      upsert(event.assistantMessage)
      break
    case 'conversation.title':
      setConversationTitle(event.conversationId, event.title)
      break
    case 'message.usage': {
      if (state.activeRun?.id !== event.runId) {
        break
      }
      const message = state.messages.find((x) => x.id === event.messageId)
      if (message) {
        message.usage = event.usage
      }
      break
    }
    case 'timeline.update': {
      if (state.activeRun?.id !== event.runId) {
        break
      }
      const message = state.messages.find((x) => x.id === event.messageId)
      if (message) {
        applyTimelineItem(message, event.item)
      }
      break
    }
    case 'timeline.delta': {
      if (state.activeRun?.id !== event.runId) {
        break
      }
      const message = state.messages.find((x) => x.id === event.messageId)
      if (message) {
        applyTimelineDelta(message, event.itemId, event.revision, event.delta)
      }
      break
    }
    case 'assistant.replace': {
      if (state.activeRun?.id !== event.runId) {
        break
      }
      const message = state.messages.find(
        (item) => item.id === event.messageId,
      )
      if (message) {
        message.content = event.content
      }
      break
    }
    case 'assistant.delta': {
      if (state.activeRun?.id !== event.runId) {
        break
      }
      const message = state.messages.find(
        (item) => item.id === event.messageId,
      )
      if (message) {
        message.content += event.delta
      }
      break
    }
    case 'tool.update': {
      const message = state.messages.find(
        (item) => item.id === event.messageId,
      )
      if (!message || state.activeRun?.id !== event.runId) {
        break
      }
      if (event.attachments) {
        message.attachments = event.attachments
      }
      const index = message.toolCalls.findIndex(
        (tool) => tool.id === event.tool.id,
      )
      if (index < 0) {
        message.toolCalls.push(event.tool)
      } else {
        message.toolCalls[index] = event.tool
      }
      if (state.activeRun) {
        state.activeRun.status =
          event.tool.status === 'waiting_client' ? 'waiting_client' : 'running'
      }
      break
    }
    case 'tool.request':
      void handleClientTool(event, currentGeneration)
      break
    case 'run.finished':
      cancelClientInteractions()
      applySnapshot(event.snapshot)
      persistSession()
      state.outcomeUncertain = false
      state.pendingText = ''
      state.cancelling = false
      for (const key of toolResults.keys()) {
        if (key.startsWith(`${event.runId}:`)) {
          toolResults.delete(key)
        }
      }
      break
    case 'error':
      if (event.requestId === state.retryRequestId) {
        state.retryRequestId = ''
      }
      if (event.requestId && messageMutations.has(event.requestId)) {
        const mutation = messageMutations.get(event.requestId)!
        clearTimeout(mutation.timer)
        messageMutations.delete(event.requestId)
        state.mutationRequestId = ''
        mutation.reject(new Error(event.message))
      }
      if (pendingDraft && event.requestId === pendingDraft.requestId) {
        state.failedDraft = pendingDraft
        pendingDraft = null
      }
      state.error = event.message
      state.errorCode = event.code
      state.pendingText = ''
      clearTimeout(acceptanceTimer)
      if (event.code === 'RESOURCE_LOCKED' && event.resourceRefs?.length) {
        pendingAuthorization = event.resourceRefs
        reconnectBlocked = false
        socket?.close()
        break
      }
      if (
        [
          'SESSION_EXPIRED',
          'SESSION_INVALID',
          'LEDGER_NOT_FOUND',
          'LEDGER_LOCKED',
          'UNAUTHENTICATED',
        ].includes(event.code)
      ) {
        reconnectBlocked = true
        state.activeRun = null
        socket?.close()
      } else if (event.code === 'SESSION_IN_USE') {
        state.error = '原连接尚未释放，正在等待恢复。系统不会重复发送消息。'
        socket?.close()
      }
      break
    case 'pong':
      break
  }
  if (
    state.connection === 'connected' &&
    taskRecovery.take(state.task, chatBusy.value)
  ) {
    resumeTask()
  }
}

function scheduleReconnect() {
  if (!started || reconnectBlocked) {
    return
  }
  const delay = Math.min(15000, 1000 * 2 ** Math.min(retries++, 4))
  reconnectTimer = setTimeout(connect, delay)
}

async function connect() {
  if (!started) {
    return
  }
  clearTimers()
  const currentGeneration = ++generation
  const previous = socket
  socket = null
  state.connection = state.sessionId ? 'restoring' : 'connecting'
  if (previous && previous.readyState !== WebSocket.CLOSED) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1500)
      previous.addEventListener(
        'close',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
      previous.close()
    })
  }
  if (currentGeneration !== generation || !started) {
    return
  }
  if (pendingAuthorization.length) {
    try {
      const authorized = await authorizeResources(
        pendingAuthorization,
        '恢复会话与待处理任务',
      )
      if (currentGeneration !== generation || !started) {
        return
      }
      if (!authorized) {
        throw new Error(
          '尚未授权受保护资源，任务会保持暂停。可重新连接后继续。',
        )
      }
      pendingAuthorization = []
    } catch (cause) {
      if (currentGeneration !== generation || !started) {
        return
      }
      state.connection = 'offline'
      state.error =
        cause instanceof Error
          ? cause.message
          : '资源授权失败，请重新连接后继续。'
      reconnectBlocked = true
      return
    }
  }
  try {
    socket = new WebSocket(chatWebSocketUrl())
  } catch (error) {
    state.connection = 'offline'
    state.error = error instanceof Error ? error.message : '无法连接对话服务。'
    reconnectBlocked = true
    return
  }
  const current = socket
  handshakeTimer = setTimeout(() => current.close(), 12000)
  current.onopen = () => {
    if (currentGeneration !== generation) {
      return
    }
    lastReceivedAt = Date.now()
    transmit({
      type: 'session.open',
      clientCapabilities,
      ...(state.conversationId ? { conversationId: state.conversationId } : {}),
      authToken: identity.token,
      ...(state.sessionId && sessionToken
        ? { sessionId: state.sessionId, token: sessionToken }
        : {}),
    })
    heartbeatTimer = setInterval(() => {
      if (Date.now() - lastReceivedAt > 45000) {
        current.close()
        return
      }
      transmit({ type: 'ping' })
    }, 15000)
  }
  current.onmessage = (message) => {
    if (currentGeneration !== generation || typeof message.data !== 'string') {
      return
    }
    lastReceivedAt = Date.now()
    try {
      const event = JSON.parse(message.data) as ChatServerEvent
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
        throw new Error('invalid event')
      }
      receive(event, currentGeneration)
    } catch {
      state.error = '对话服务返回了无法读取的数据，请重新连接。'
      current.close()
    }
  }
  current.onerror = () => {
    /* onclose owns recovery so messages are never retried here. */
  }
  current.onclose = () => {
    if (currentGeneration !== generation) {
      return
    }
    cancelClientInteractions()
    clearTimers()
    if (state.activeRun || state.pendingText || state.retryRequestId) {
      state.outcomeUncertain = true
    }
    state.retryRequestId = ''
    state.connection = 'offline'
    rejectMutations('连接中断，删除结果尚未确认；请重新连接后查看对话。')
    state.pendingText = ''
    if (!state.error) {
      state.error =
        '连接已断开，后端会继续处理；需要你操作时会暂停。正在恢复连接…'
    }
    scheduleReconnect()
  }
}

export function startChat() {
  if (started) {
    return
  }
  started = true
  pendingAuthorization = []
  state.messages = []
  state.activeRun = null
  state.task = null
  state.pendingText = ''
  state.sessionId = ''
  state.conversationId = ''
  state.title = ''
  state.conversationRevision = undefined
  state.branch = undefined
  state.failedDraft = null
  pendingDraft = null
  sessionToken = ''
  state.error = ''
  state.errorCode = ''
  reconnectBlocked = false
  state.connection = 'connecting'
  readSession()
  connect()
}

export function stopChat() {
  state.retryRequestId = ''
  rejectMutations('会话已关闭，请检查操作结果')
  pendingDraft = null
  state.failedDraft = null
  taskRecovery.clear()
  cancelClientInteractions()
  started = false
  generation++
  clearTimers()
  socket?.close()
  socket = null
}

export function reconnectChat() {
  reconnectBlocked = false
  state.error = ''
  state.errorCode = ''
  retries = 0
  connect()
}

export function sendMessage(
  text: string,
  attachments: readonly Resource[] = [],
  applicationIds: readonly ApplicationId[] = [],
  revision?: { sourceMessageId: string, expectedRevision?: number },
): boolean {
  const value = text.trim() || (attachments.length ? '请查看附件。' : '')
  if (!value || value.length > state.maxMessageLength || !canSendMessage.value) {
    return false
  }
  const date = new Date()
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const event: ChatClientEvent = {
    ...(revision
      ? { type: 'message.resend' as const, ...revision }
      : { type: 'message.send' as const }),
    requestId: createRequestId(),
    text: value,
    localDate,
    scopeBindings: currentScopeBindings(),
    attachmentIds: attachments.map((resource) => resource.id),
    applicationIds: [...applicationIds],
  }
  taskRecovery.clear()
  pendingDraft = {
    requestId: event.requestId,
    text: value,
    attachments: attachments.map((r) => ({ ...r })),
    applicationIds: [...applicationIds],
    ...revision,
  }
  state.failedDraft = null
  state.pendingText = value
  state.error = ''
  state.errorCode = ''
  if (!transmit(event)) {
    pendingDraft = null
    state.pendingText = ''
    state.error = '发送未得到确认，请恢复连接后查看对话。系统不会自动重发。'
    state.outcomeUncertain = true
    return false
  }
  acceptanceTimer = setTimeout(() => {
    if (state.pendingText) {
      state.error = '发送结果尚未确认，正在恢复会话；系统不会自动重发。'
      state.outcomeUncertain = true
      socket?.close()
    }
  }, 15000)
  return true
}

export function takeFailedDraft() {
  const draft = state.failedDraft
  state.failedDraft = null
  return draft
}

export function retryAnswer(messageId: string): boolean {
  if (!canSendMessage.value) {
    return false
  }
  const message = state.messages.find(
    (m) => m.id === messageId && m.role === 'assistant',
  )
  if (!message) {
    return false
  }
  const requestId = createRequestId()
  taskRecovery.clear()
  state.retryRequestId = requestId
  state.error = ''
  state.errorCode = ''
  if (
    !transmit({
      type: 'message.retry',
      requestId,
      messageId,
      expectedRevision: state.conversationRevision,
    })
  ) {
    state.retryRequestId = ''
    state.error = '重试未得到确认，请恢复连接后查看回答。'
    state.outcomeUncertain = true
    return false
  }
  acceptanceTimer = setTimeout(() => {
    if (state.retryRequestId === requestId) {
      state.error = '重试结果尚未确认，正在恢复会话；系统不会自动重试。'
      state.outcomeUncertain = true
      socket?.close()
    }
  }, 15000)
  return true
}
export async function deleteMessage(messageId: string): Promise<void> {
  if (
    chatBusy.value ||
    state.connection !== 'connected' ||
    taskBlocksNewMessage(state.task)
  ) {
    throw new Error('请等待生成结束后再删除')
  }
  taskRecovery.clear()
  const requestId = createRequestId()
  state.mutationRequestId = requestId
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      messageMutations.delete(requestId)
      state.mutationRequestId = ''
      reject(
        new Error('删除结果尚未确认，请重新连接后查看对话；不要重复操作。'),
      )
      socket?.close()
    }, 15000)
    messageMutations.set(requestId, { resolve, reject, timer })
    if (
      !transmit({
        type: 'message.delete',
        requestId,
        messageId,
        expectedRevision: state.conversationRevision,
      })
    ) {
      clearTimeout(timer)
      messageMutations.delete(requestId)
      state.mutationRequestId = ''
      reject(new Error('对话服务尚未连接'))
    }
  })
}

export function cancelRun() {
  if (!state.activeRun || state.connection !== 'connected') {
    return
  }
  if (transmit({ type: 'run.cancel', runId: state.activeRun.id })) {
    state.cancelling = true
  }
}
export function resumeTask() {
  if (
    !state.task ||
    !['queued', 'paused', 'waiting_client'].includes(state.task.status) ||
    chatBusy.value ||
    state.connection !== 'connected'
  ) {
    return false
  }
  state.error = ''
  state.errorCode = ''
  if (!transmit({ type: 'task.resume', taskId: state.task.id })) {
    return false
  }
  state.pendingText = '正在继续任务…'
  acceptanceTimer = setTimeout(() => {
    if (state.pendingText) {
      socket?.close()
    }
  }, 15000)
  return true
}
export function endTask() {
  if (!state.task || state.connection !== 'connected') {
    return false
  }
  return transmit({ type: 'task.cancel', taskId: state.task.id })
}

export function newConversation(): boolean {
  if (chatBusy.value) {
    return false
  }
  pendingAuthorization = []
  state.messages = []
  state.task = null
  state.sessionId = ''
  state.conversationId = ''
  state.title = ''
  state.conversationRevision = undefined
  state.branch = undefined
  state.failedDraft = null
  pendingDraft = null
  sessionToken = ''
  state.mode = null
  state.error = ''
  state.errorCode = ''
  state.outcomeUncertain = false
  state.cancelling = false
  toolResults.clear()
  try {
    localStorage.removeItem(storageKey())
  } catch {
    /* Session remains usable in memory. */
  }
  reconnectBlocked = false
  retries = 0
  connect()
  return true
}

export function setConversationTitle(id: string, title: string) {
  if (state.conversationId === id) {
    state.title = title
  }
}

export function dismissUncertainty() {
  state.outcomeUncertain = false
}
export function openConversation(id: string) {
  if (chatBusy.value) {
    return false
  }
  pendingAuthorization = []
  state.messages = []
  state.task = null
  state.sessionId = ''
  sessionToken = ''
  state.conversationId = id
  state.title = ''
  state.conversationRevision = undefined
  state.branch = undefined
  state.failedDraft = null
  pendingDraft = null
  state.activeRun = null
  state.error = ''
  state.errorCode = ''
  state.outcomeUncertain = false
  toolResults.clear()
  reconnectBlocked = false
  retries = 0
  connect()
  return true
}
if (import.meta.hot) {
  if (import.meta.hot.data.wasStarted && identity.token) {
    queueMicrotask(startChat)
  }
  import.meta.hot.dispose((data) => {
    data.wasStarted = started
    stopChat()
  })
}
