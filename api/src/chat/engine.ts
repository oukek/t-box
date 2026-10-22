import type { ChatServerEvent } from '@t-box/shared'
import type { RunCheckpoint } from '../agent/checkpoint.js'
import type { Actor, AgentRuntimeOptions } from '../agent/contracts.js'
import type { AgentRunInput } from '../agent/runner.js'
import type { ChatSession, SessionRepository } from './session.js'
import { ApiError } from '@t-box/server-foundation/errors'
import { CHAT_LIMITS } from '@t-box/shared'
import { ResourceAuthorizationRequired } from '../agent/access.js'
import { restoreCheckpoint } from '../agent/checkpoint.js'
import { rebuildConversationHistory } from '../agent/history.js'
import { prepareTaskResume } from '../agent/resume.js'
import { runConversation } from '../agent/runner.js'
import { object, parseDate, parseIdentifier } from '../agent/schema.js'
import { authorizedSnapshot } from '../agent/snapshot.js'
import { handleTaskCommand } from '../agent/task-commands.js'
import { parseToolResult } from '../agent/tool-result-schema.js'
import { settingNumber } from '../configuration/defaults.js'
import { ErrorCode } from '../error-codes.js'
import { retryPair } from './answer-retry.js'
import {
  checkMessageRevision,
  deleteMessagePair,
  forkMessageConversation,
  messagePair,
  refreshMessageState,
  retireSuspendedTask,
} from './message-commands.js'
import { MemorySessionRepository, snapshot } from './session.js'

export type ChatServiceOptions = AgentRuntimeOptions

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) {
    throw ErrorCode.INVALID_EVENT()
  }
  return value as string
}

export class ChatService {
  readonly sessions: SessionRepository
  get access() {
    return this.options.registry.access
  }

  get registry() {
    return this.options.registry
  }

  private readonly jobs = new Set<Promise<void>>()
  private readonly backgroundSessions = new MemorySessionRepository()
  constructor(private readonly options: ChatServiceOptions) {
    this.sessions = options.sessions ?? new MemorySessionRepository()
  }

  private startRun(input: AgentRunInput, sessions = this.sessions) {
    const job = runConversation(this.options, sessions, input)
    this.jobs.add(job)
    void job.finally(() => this.jobs.delete(job))
    return job
  }

  /** No fake socket or blanket permissions: required device interactions pause naturally. */
  async resumeInBackground(
    task: {
      id: string
      userId: string
      conversationId: string
      sessionHash: string
    },
    recoveryClaim: string,
  ) {
    if (!this.options.host) {
      throw ErrorCode.TASKS_UNAVAILABLE.unavailable()
    }
    const principal = await this.options.host.identity.authenticateHash(
      task.sessionHash,
    )
    if (!principal || principal.user.id !== task.userId) {
      throw ErrorCode.TASK_IDENTITY_CHANGED()
    }
    // Keep recovery state separate from socket subscriber objects. Otherwise an
    // async restore can replace a live UI session while another command uses it.
    const session = this.backgroundSessions.create()
    session.userId = task.userId
    session.conversationId = task.conversationId
    try {
      const conversations = this.options.host.conversations
      if (
        conversations &&
        (await conversations.exists(principal, task.conversationId))
      ) {
        await conversations.restore(principal, task.conversationId, session)
      }
      const input = await prepareTaskResume(
        this.options,
        session,
        principal,
        task.id,
      )
      await this.startRun({ ...input, recoveryClaim }, this.backgroundSessions)
    } finally {
      if (!session.owner) {
        this.backgroundSessions.remove(session.id)
      }
    }
  }

  connect(send: (event: ChatServerEvent) => void) {
    const owner = Symbol('chat socket')
    let session: ChatSession | undefined
    let closed = false
    let ready = false
    let opening = false
    let principal: Actor | undefined
    const receive = async (input: unknown) => {
      if (closed) {
        return
      }
      let requestId: string | undefined
      try {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw ErrorCode.INVALID_EVENT('消息必须为 JSON 对象')
        }
        const event = this.options.registry.decodeEvent(
          input as Record<string, unknown>,
        )
        if (event.type === 'ping') {
          object(event, ['type'])
          if (session) {
            this.sessions.touch(session)
          }
          if (
            principal &&
            session?.conversationId &&
            session.task &&
            !session.active &&
            this.options.host?.tasks
          ) {
            // Another process may own this task. Refresh its durable timeline,
            // never overwrite it with the subscriber's stale in-memory messages.
            session.task = await this.options.host.tasks.current(
              principal,
              session.conversationId,
            )
            await this.options.host.conversations?.restore(
              principal,
              session.conversationId,
              session,
              false,
              session.task?.status === 'running',
            )
            send({
              type: 'session.snapshot',
              snapshot: await authorizedSnapshot(
                this.options,
                session,
                this.options.provider.mode,
                principal,
              ),
            })
          }
          send({ type: 'pong' })
          return
        }
        if (event.type === 'session.open') {
          object(event, [
            'type',
            'sessionId',
            'token',
            'authToken',
            'conversationId',
            'clientCapabilities',
          ])
          if (session || opening) {
            throw ErrorCode.SESSION_ALREADY_OPEN()
          }
          opening = true
          try {
            const capabilities = event.clientCapabilities
            if (
              capabilities !== undefined &&
              (!Array.isArray(capabilities) ||
                capabilities.length > 128 ||
                capabilities.some(
                  (name) =>
                    typeof name !== 'string' || !/^[\w-]{1,64}$/.test(name),
                ) ||
                new Set(capabilities).size !== capabilities.length)
            ) {
              throw ErrorCode.INVALID_EVENT('客户端能力列表无效')
            }
            if (this.options.host) {
              principal = await this.options.host.identity.authenticate(
                typeof event.authToken === 'string' ? event.authToken : '',
              )
            }
            const restoring =
              event.sessionId !== undefined || event.token !== undefined
            if (
              restoring &&
              (typeof event.sessionId !== 'string' ||
                typeof event.token !== 'string' ||
                event.token.length > 128)
            ) {
              throw ErrorCode.SESSION_INVALID(
                '恢复会话需要有效的会话 ID 和凭据',
              )
            }
            const conversationId =
              event.conversationId === undefined
                ? undefined
                : parseIdentifier(event.conversationId)
            const live =
              conversationId && principal
                ? [...this.sessions.all()].find(
                    (s) =>
                      s.conversationId === conversationId &&
                      s.userId === principal!.user.id,
                  )
                : undefined
            let candidate: ChatSession
            let restored = restoring
            if (restoring) {
              try {
                candidate = this.sessions.restore(
                  event.sessionId as string,
                  event.token as string,
                )
              } catch (error) {
                if (
                  !(error instanceof ApiError) ||
                  error.code !== 'SESSION_EXPIRED' ||
                  !principal ||
                  (conversationId && !this.options.host?.conversations)
                ) {
                  throw error
                }
                // Login authentication is required above. Expired transport credentials
                // do not authorize history: archives still enforce ownership/access below.
                // A blank conversation has no archive yet and can safely get a fresh transport.
                candidate = live ?? this.sessions.create()
                restored = Boolean(conversationId)
              }
            } else {
              candidate = live ?? this.sessions.create()
            }
            if (candidate.owner) {
              throw ErrorCode.SESSION_IN_USE()
            }
            if (
              conversationId &&
              principal &&
              this.options.host?.conversations
            ) {
              try {
                if (
                  candidate.conversationId &&
                  candidate.conversationId !== conversationId
                ) {
                  throw ErrorCode.SESSION_INVALID()
                }
                if (!candidate.active && !candidate.finishing) {
                  try {
                    const durable = await this.options.host.tasks?.current(
                      principal,
                      conversationId,
                    )
                    await this.options.host.conversations.restore(
                      principal,
                      conversationId,
                      candidate,
                      false,
                      durable?.status === 'running',
                    )
                  } catch (error) {
                    // Admission is durable before the first archive write. Recover even if
                    // that archive write failed; task ownership and resource grants still apply.
                    if (
                      !(error instanceof ApiError) ||
                      error.code !== 'CONVERSATION_NOT_FOUND' ||
                      !this.options.host.tasks
                    ) {
                      throw error
                    }
                    const task = await this.options.host.tasks.current(
                      principal,
                      conversationId,
                    )
                    if (!task) {
                      throw error
                    }
                    const saved = await this.options.host.tasks.get(
                      principal,
                      task.id,
                    )
                    const cp = saved.checkpoint as RunCheckpoint
                    if (cp.version !== 1) {
                      throw error
                    }
                    await this.options.registry.access.history(
                      principal,
                      cp.session.messages,
                    )
                    restoreCheckpoint(candidate, cp)
                    candidate.userId = principal.user.id
                    candidate.conversationId = conversationId
                    await this.options.host.conversations.save(candidate)
                  }
                } else if (candidate.archived) {
                  const saved = (await this.options.host.conversations.load(
                    principal,
                    conversationId,
                  )) as { title?: string }
                  candidate.title = saved?.title
                }
                if (candidate.conversationId !== conversationId) {
                  throw ErrorCode.SESSION_INVALID()
                }
              } catch (error) {
                if (!candidate.conversationId) {
                  this.sessions.remove?.(candidate.id)
                }
                throw error
              }
            }
            if (
              principal &&
              candidate.userId &&
              candidate.userId !== principal.user.id
            ) {
              throw ErrorCode.SESSION_INVALID('会话不属于当前用户')
            }
            if (principal) {
              candidate.userId = principal.user.id
            }
            this.options.registry.migrateSession(candidate)
            if (candidate.rebuildHistory) {
              candidate.history = rebuildConversationHistory(
                candidate,
                this.options.registry,
                this.options.host?.attachments,
              )
              candidate.contextState = {}
              delete candidate.rebuildHistory
            }
            if (principal) {
              await this.options.registry.access.history(
                principal,
                candidate.messages,
              )
            }
            if (candidate.owner) {
              throw ErrorCode.SESSION_IN_USE()
            }
            if (closed) {
              if (
                !candidate.owner &&
                !candidate.active &&
                !candidate.finishing
              ) {
                this.sessions.remove?.(candidate.id)
              }
              return
            }
            session = candidate
            session.owner = owner
            session.clientCapabilities = capabilities as string[] | undefined
            session.send = (event) => {
              if (!closed && ready && session?.owner === owner) {
                send(event)
              }
            }
            if (this.options.provider.forRun) {
              session.mode = (
                await this.options.provider.forRun({ peek: true })
              ).mode
            }
            if (closed) {
              return
            }
            if (
              principal &&
              session.conversationId &&
              this.options.host?.tasks
            ) {
              session.task = await this.options.host.tasks.current(
                principal,
                session.conversationId,
              )
            }
            if (closed || session.owner !== owner) {
              return
            }
            const configuration = this.options.configuration
              ? await this.options.configuration.snapshot()
              : undefined
            if (closed || session.owner !== owner) {
              return
            }
            ready = true
            send({
              type: 'session.ready',
              token: session.token,
              restored,
              snapshot: snapshot(session, this.options.provider.mode),
            })
            if (configuration) {
              send({
                type: 'runtime.configuration',
                maxMessageLength: settingNumber(
                  configuration,
                  'ai.input.maxLength',
                  CHAT_LIMITS.maxMessageLength,
                ),
              })
            }
            return
          } finally {
            opening = false
          }
        }
        if (!ready || !session || session.owner !== owner) {
          throw ErrorCode.SESSION_REQUIRED()
        }
        let current = session!
        this.sessions.touch(current)
        if (event.type === 'task.cancel' || event.type === 'task.resume') {
          await handleTaskCommand(
            this.options,
            current,
            principal,
            event,
            () => !closed && current.owner === owner,
            (input) => this.startRun(input),
          )
          return
        }
        if (event.type === 'message.delete') {
          object(event, ['type', 'requestId', 'messageId', 'expectedRevision'])
          requestId = id(event.requestId)
          const messageId = id(event.messageId)
          if (current.active || current.finishing) {
            throw ErrorCode.RUN_IN_PROGRESS()
          }
          current.finishing = true
          try {
            const messageIds = await deleteMessagePair(
              this.options,
              current,
              principal,
              {
                requestId,
                messageId,
                expectedRevision: event.expectedRevision,
              },
            )
            send({
              type: 'message.deleted',
              requestId,
              messageIds,
              snapshot: await authorizedSnapshot(
                this.options,
                current,
                this.options.provider.mode,
                principal,
              ),
            })
          } finally {
            current.finishing = false
          }
          return
        }
        if (event.type === 'message.retry') {
          object(event, ['type', 'requestId', 'messageId', 'expectedRevision'])
          requestId = id(event.requestId)
          const messageId = id(event.messageId)
          if (current.active || current.finishing) {
            throw ErrorCode.RUN_IN_PROGRESS('请等待生成结束后再重试')
          }
          current.finishing = true
          let retryInput: AgentRunInput | undefined
          try {
            await refreshMessageState(this.options, current, principal)
            if (closed || current.owner !== owner) {
              return
            }
            const duplicate = current.requests.get(requestId)
            if (duplicate) {
              if (duplicate.retryMessageId !== messageId) {
                throw ErrorCode.REQUEST_ID_CONFLICT(
                  '同一请求 ID 不可用于不同重试',
                )
              }
              send({
                type: 'session.snapshot',
                snapshot: snapshot(current, this.options.provider.mode),
              })
              return
            }
            checkMessageRevision(current, event.expectedRevision)
            const pair = retryPair(current, messageId)
            const provider = this.options.provider.forRun
              ? await this.options.provider.forRun({
                  preferredConfigurationKey: current.configurationKey,
                  supportsVision: pair.messages.some((message) =>
                    message.attachments?.some((file) =>
                      file.mimeType.startsWith('image/'),
                    ),
                  ),
                })
              : this.options.provider
            if (provider.mode === 'unconfigured') {
              throw ErrorCode.AI_NOT_CONFIGURED()
            }
            if (current.requests.size >= 1000) {
              throw ErrorCode.SESSION_LIMIT()
            }
            await retireSuspendedTask(this.options, current, principal)
            if (closed || current.owner !== owner) {
              return
            }
            const bindings = this.options.registry.access.references(
              pair.messages,
            )
            const originalDate = new Date(pair.user.createdAt)
            const localDate = parseDate(
              pair.user.localDate ||
              (Number.isNaN(originalDate.getTime())
                ? new Date()
                : originalDate
              )
                .toISOString()
                .slice(0, 10),
            )
            const applicationIds = pair.user.applicationIds || []
            const attachments = pair.user.attachments || []
            current.requests.set(requestId, {
              text: pair.user.content,
              localDate,
              scopeBindings: bindings,
              attachmentIds: attachments.map((r) => r.id),
              applicationIds,
              retryMessageId: messageId,
            })
            retryInput = {
              session: current,
              requestId,
              text: pair.user.content,
              localDate,
              bindings,
              principal,
              attachments,
              provider,
              applicationIds,
              retry: { assistantId: messageId },
            }
          } finally {
            current.finishing = false
          }
          if (retryInput) {
            this.startRun(retryInput)
          }
          return
        }
        if (event.type === 'message.send' || event.type === 'message.resend') {
          object(event, [
            'type',
            'requestId',
            'text',
            'localDate',
            'scopeBindings',
            'attachmentIds',
            'applicationIds',
            'memoryEnabled',
            ...(event.type === 'message.resend'
              ? ['sourceMessageId', 'expectedRevision']
              : []),
          ])
          requestId = id(event.requestId)
          if (event.memoryEnabled !== undefined && typeof event.memoryEnabled !== 'boolean') {
            throw ErrorCode.INVALID_EVENT()
          }
          const sourceMessageId =
            event.type === 'message.resend'
              ? id(event.sourceMessageId)
              : undefined
          const maxLength = settingNumber(
            this.options.configuration
              ? await this.options.configuration.snapshot()
              : undefined,
            'ai.input.maxLength',
            CHAT_LIMITS.maxMessageLength,
          )
          if (
            typeof event.text !== 'string' ||
            !event.text.trim() ||
            event.text.length > maxLength
          ) {
            throw ErrorCode.INVALID_EVENT(`消息长度应为 1–${maxLength} 字`)
          }
          const localDate = parseDate(event.localDate)
          const text = (event.text as string).trim()
          const applicationIds = this.options.registry.parseApplications(
            event.applicationIds,
          )
          const bindings = this.options.registry.access.parse(
            event.scopeBindings,
          )
          if (principal) {
            for (const ref of bindings) {
              await this.options.registry.access.inspect(
                principal,
                ref,
                'read',
                '选择应用资源',
              )
            }
          }
          if (principal) {
            await this.options.host!.identity.authenticateHash(
              principal.sessionHash,
            )
          }
          const attachments =
            principal && this.options.host?.attachments
              ? await this.options.host.attachments.attachments(
                  principal,
                  event.attachmentIds,
                )
              : []
          const attachmentIds = attachments.map((r) => r.id)
          if (current.conversationId && this.options.host?.conversations) {
            const exists = await this.options.host.conversations.exists(
              principal!,
              current.conversationId,
            )
            if (!exists) {
              throw ErrorCode.CONVERSATION_NOT_FOUND.invalid()
            }
          }
          const provider = this.options.provider.forRun
            ? await this.options.provider.forRun({
                preferredConfigurationKey: current.configurationKey,
                supportsVision: [
                  ...attachments,
                  ...current.messages.flatMap(
                    (message) => message.attachments || [],
                  ),
                ].some((file) => file.mimeType.startsWith('image/')),
              })
            : this.options.provider
          if (closed || current.owner !== owner) {
            return
          }
          current.mode = provider.mode
          const duplicate = current.requests.get(requestId)
          if (duplicate) {
            if (principal) {
              await this.options.registry.access.history(
                principal,
                current.messages,
              )
            }
            // Recheck after asynchronous access checks: two receives must not start the same run.
            if (closed || current.owner !== owner) {
              return
            }
            if (
              duplicate.retryMessageId ||
              duplicate.sourceMessageId !== sourceMessageId ||
              duplicate.text !== text ||
              (duplicate.memoryEnabled !== false) !== (event.memoryEnabled !== false) ||
              duplicate.localDate !== localDate ||
              JSON.stringify(duplicate.scopeBindings || []) !==
              JSON.stringify(bindings) ||
              JSON.stringify(duplicate.attachmentIds || []) !==
              JSON.stringify(attachmentIds) ||
              JSON.stringify(duplicate.applicationIds || []) !==
              JSON.stringify(applicationIds)
            ) {
              throw ErrorCode.REQUEST_ID_CONFLICT()
            }
            send({
              type: 'session.snapshot',
              snapshot: snapshot(current, this.options.provider.mode),
            })
            return
          }
          if (provider.mode === 'unconfigured') {
            send({
              type: 'session.snapshot',
              snapshot: snapshot(current, provider.mode),
            })
            throw ErrorCode.AI_NOT_CONFIGURED()
          }
          if (current.active || current.finishing) {
            throw ErrorCode.RUN_IN_PROGRESS('当前任务尚未结束，请等待或停止')
          }
          const locked = current
          locked.finishing = true
          let branch: ChatSession | undefined
          try {
            await refreshMessageState(
              this.options,
              current,
              principal,
              !!sourceMessageId,
            )
            if (closed || current.owner !== owner) {
              return
            }
            const savedRequest = current.requests.get(requestId)
            if (savedRequest) {
              if (
                savedRequest.retryMessageId ||
                savedRequest.sourceMessageId !== sourceMessageId ||
                savedRequest.text !== text ||
                (savedRequest.memoryEnabled !== false) !== (event.memoryEnabled !== false) ||
                savedRequest.localDate !== localDate ||
                JSON.stringify(savedRequest.scopeBindings || []) !==
                JSON.stringify(bindings) ||
                JSON.stringify(savedRequest.attachmentIds || []) !==
                JSON.stringify(attachmentIds) ||
                JSON.stringify(savedRequest.applicationIds || []) !==
                JSON.stringify(applicationIds)
              ) {
                throw ErrorCode.REQUEST_ID_CONFLICT()
              }
              send({
                type: 'session.snapshot',
                snapshot: snapshot(current, provider.mode),
              })
              return
            }
            if (sourceMessageId) {
              checkMessageRevision(current, event.expectedRevision)
              const pair = messagePair(current.messages, sourceMessageId)
              if (pair.messages[0]!.id !== sourceMessageId) {
                throw ErrorCode.MESSAGE_ROLE_INVALID()
              }
            }
            await retireSuspendedTask(this.options, current, principal)
            if (closed || current.owner !== owner) {
              return
            }
            if (sourceMessageId) {
              branch = forkMessageConversation(
                this.options,
                current,
                this.sessions,
                sourceMessageId,
              )
            }
          } finally {
            locked.finishing = false
          }
          if (branch) {
            current.owner = undefined
            current.send = undefined
            session = current = branch
            current.owner = owner
            current.send = send
            send({
              type: 'session.ready',
              token: current.token,
              snapshot: snapshot(current, provider.mode),
              restored: false,
            })
          }
          if (current.requests.size >= 1000) {
            throw ErrorCode.SESSION_LIMIT(
              '当前会话已达长度上限，请新建对话；已完成的操作会保留',
            )
          }
          current.requests.set(requestId, {
            text,
            localDate,
            scopeBindings: bindings,
            attachmentIds,
            applicationIds,
            sourceMessageId,
            memoryEnabled: event.memoryEnabled !== false,
          })
          current.scopeBindings = bindings
          // runConversation() establishes the lock synchronously before its first await.
          this.startRun({
            session: current,
            requestId,
            text,
            localDate,
            principal,
            bindings,
            attachments,
            provider,
            applicationIds,
            memoryEnabled: event.memoryEnabled !== false,
          })
          return
        }
        if (event.type === 'run.cancel') {
          object(event, ['type', 'runId'])
          if (!current.active || event.runId !== current.active.view.id) {
            throw ErrorCode.RUN_NOT_FOUND()
          }
          current.active!.abort.abort('CANCELLED')
          return
        }
        if (event.type === 'tool.result') {
          object(event, ['type', 'runId', 'callId', 'result'])
          const run = current.active
          if (
            !run ||
            run.abort.signal.aborted ||
            event.runId !== run.view.id ||
            event.callId !== run.pending?.callId ||
            run.pending?.owner !== owner
          ) {
            throw ErrorCode.INVALID_TOOL_RESULT(
              '回执不属于此连接的待执行工具，或已经过期',
            )
          }
          run!.pending!.settle(parseToolResult(event.result))
          return
        }
        throw ErrorCode.INVALID_EVENT('未知的消息类型')
      } catch (error) {
        send({
          type: 'error',
          code: error instanceof ApiError ? error.code : 'INVALID_EVENT',
          message: error instanceof ApiError ? error.message : '消息格式不正确',
          ...(requestId ? { requestId } : {}),
          ...(error instanceof ResourceAuthorizationRequired
            ? { resourceRefs: [error.resource] }
            : {}),
        })
      }
    }
    return {
      receive,
      close() {
        closed = true
        if (session?.owner === owner) {
          session.owner = undefined
          session.send = undefined
          // A socket is a subscriber. Only an outstanding UI request needs to pause execution.
          session.active?.pending?.disconnect()
        }
      },
    }
  }

  async close() {
    for (const session of [
      ...this.sessions.all(),
      ...this.backgroundSessions.all(),
    ]) {
      session.active?.abort.abort('SERVER_SHUTDOWN')
    }
    await Promise.allSettled(this.jobs)
    this.sessions.clear()
    this.backgroundSessions.clear()
  }
}
