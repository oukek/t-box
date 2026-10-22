import type {
  ApplicationId,
  ChatMessage,
  ChatMode,
  ChatRun,
  ChatServerEvent,
  ChatSnapshot,
  ResourceRef,
  TaskSummary,
  ToolResult,
} from '@t-box/shared'
import type { ProviderItem } from './provider.js'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { ErrorCode } from '../error-codes.js'

export interface SessionRun {
  view: ChatRun
  abort: AbortController
  pending?: {
    callId: string
    owner: symbol
    settle: (result: ToolResult) => void
    disconnect: () => void
  }
}
export interface ChatSession {
  answerRetryEvidence?: Record<
    string,
    {
      toolCalls: import('@t-box/shared').ToolCallView[]
      calls: [string, { fingerprint: string, result: ToolResult }][]
    }
  >
  pendingAnswerVersion?: {
    requestId: string
    message: ChatMessage
    calls: [string, { fingerprint: string, result: ToolResult }][]
  }
  branch?: import('@t-box/shared').ConversationBranch & {
    executionContext?: string
    resourceRefs?: ResourceRef[]
  }
  messageCommands?: Record<
    string,
    { fingerprint: string, messageIds: string[] }
  >

  contextState?: import('../agent/context.js').ContextState
  title?: string
  task?: TaskSummary | null
  mode?: ChatMode
  userId?: string
  scopeBindings?: ResourceRef[]
  configurationKey?: string
  conversationId?: string
  archived?: boolean
  archiveRevision?: number
  rebuildHistory?: boolean
  id: string
  token: string
  expiresAt: number
  messages: ChatMessage[]
  history: ProviderItem[]
  requests: Map<
    string,
    {
      text: string
      memoryEnabled?: boolean
      localDate: string
      scopeBindings?: ResourceRef[]
      attachmentIds?: string[]
      applicationIds?: ApplicationId[]
      sourceMessageId?: string
      retryMessageId?: string
    }
  >
  calls: Map<string, { fingerprint: string, result: ToolResult }>
  active?: SessionRun
  /** Locks the session until the final durable snapshot has finished saving. */
  finishing?: boolean
  clientCapabilities?: string[]
  owner?: symbol
  send?: (event: ChatServerEvent) => void
}

/**
 * Storage boundary. A durable/Redis implementation must preserve atomic ownership
 * and request/call deduplication, not merely serialize the message list.
 */
export interface SessionRepository {
  create(): ChatSession
  restore(id: string, token: string): ChatSession
  touch(session: ChatSession): void
  all(): Iterable<ChatSession>
  clear(): void
  remove?(id: string): void
}

export class MemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, ChatSession>()
  constructor(
    private readonly ttlMs = 30 * 60_000,
    private readonly maxSessions = 100,
    private readonly now = Date.now,
  ) {}

  private sweep() {
    for (const [id, session] of this.sessions) {
      if (
        !session.active &&
        !session.finishing &&
        !session.owner &&
        session.expiresAt < this.now()
      ) {
        this.sessions.delete(id)
      }
    }
  }

  create(): ChatSession {
    this.sweep()
    if (this.sessions.size >= this.maxSessions) {
      throw ErrorCode.SESSION_LIMIT.limited()
    }
    const session: ChatSession = {
      id: randomUUID(),
      token: randomBytes(32).toString('hex'),
      expiresAt: this.now() + this.ttlMs,
      messages: [],
      history: [],
      requests: new Map(),
      calls: new Map(),
    }
    this.sessions.set(session.id, session)
    return session
  }

  restore(id: string, token: string): ChatSession {
    this.sweep()
    const session = this.sessions.get(id)
    if (!session) {
      throw ErrorCode.SESSION_EXPIRED()
    }
    const actual = Buffer.from(session.token)
    const incoming = Buffer.from(token)
    if (
      incoming.length !== actual.length ||
      !timingSafeEqual(incoming, actual)
    ) {
      throw ErrorCode.SESSION_INVALID.forbidden()
    }
    this.touch(session)
    return session
  }

  touch(session: ChatSession) {
    session.expiresAt = this.now() + this.ttlMs
  }

  all() {
    return this.sessions.values()
  }

  remove(id: string) {
    const session = this.sessions.get(id)
    if (session && !session.owner && !session.active && !session.finishing) {
      this.sessions.delete(id)
    }
  }

  clear() {
    this.sessions.clear()
  }
}

export function snapshot(session: ChatSession, mode: ChatMode): ChatSnapshot {
  return {
    sessionId: session.id,
    conversationRevision: session.archiveRevision,
    branch: session.branch
      ? {
          sourceConversationId: session.branch.sourceConversationId,
          sourceMessageId: session.branch.sourceMessageId,
        }
      : undefined,
    mode: session.mode ?? mode,
    messages: structuredClone(session.messages),
    activeRun: session.active ? { ...session.active.view } : null,
    conversationId: session.conversationId,
    task: session.task,
    title: session.title,
  }
}
