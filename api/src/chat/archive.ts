import type { ConversationSummary, ResourceRef } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { ResourceAccessRegistry } from '../agent/access.js'
import type { Actor } from '../agent/contracts.js'
import type { MemoryService } from '../memory/store.js'
import type { ChatSession } from './session.js'
import { randomUUID } from 'node:crypto'
import { isoTime } from '@t-box/server-foundation/time'
import { parseId } from '@t-box/server-foundation/validation'
import { uniqueResources } from '@t-box/shared'
import { In, Not } from 'typeorm'
import { ConversationEntity } from '../db/records/conversations-entities.js'
import { AgentTaskEntity } from '../db/records/tasks-entities.js'
import { ErrorCode } from '../error-codes.js'

type Saved = Pick<
  ChatSession,
  | 'messages' |
  'history' |
  'scopeBindings' |
  'configurationKey' |
  'mode' |
  'contextState' |
  'branch' |
  'messageCommands' |
  'answerRetryEvidence'
> & {
  requests: [string, unknown][]
  calls: [string, unknown][]
  interrupted: boolean
  archiveRevision: number
  title: string
}
export class ConversationArchive {
  private readonly active = new Set<string>()
  private readonly subscribers = new Map<string, { userId: string, id: string, fingerprint?: string, listeners: Set<() => void> }>()
  private watchTimer?: ReturnType<typeof setInterval>
  private watching = false
  constructor(
    readonly source: DataSource,
    private access: ResourceAccessRegistry,
    private readonly memory?: Pick<MemoryService, 'saved' | 'removed'>,
  ) {}

  subscribe(userId: string, id: string, listener: () => void) {
    const key = `${userId}:${id}`
    const entry = this.subscribers.get(key) ?? { userId, id, listeners: new Set<() => void>() }
    entry.listeners.add(listener)
    this.subscribers.set(key, entry)
    this.watchTimer ??= setInterval(() => void this.watchChanges().catch(() => {}), 2000)
    this.watchTimer.unref()
    return () => {
      entry.listeners.delete(listener)
      if (!entry.listeners.size) {
        this.subscribers.delete(key)
      }
      if (!this.subscribers.size) {
        clearInterval(this.watchTimer)
        this.watchTimer = undefined
      }
    }
  }

  private changed(userId: string, id: string) {
    for (const listener of this.subscribers.get(`${userId}:${id}`)?.listeners ?? []) {
      listener()
    }
  }

  /** One bounded probe also detects commits from the independent PM2 worker. */
  private async watchChanges() {
    if (this.watching || !this.subscribers.size) {
      return
    }
    this.watching = true
    try {
      const entries = [...this.subscribers.values()]
      const rows: { id: string, userId: string, revision: string, title: string, taskId: string | null, taskStatus: string | null, taskUpdated: Date | null }[] = await this.source.createQueryBuilder()
        .select('c.id,c.user_id AS userId,c.revision,c.title,t.id AS taskId,t.status AS taskStatus,t.updated_at AS taskUpdated')
        .from('conversations', 'c')
        .leftJoin('agent_tasks', 't', 't.active_key=c.id')
        .where('c.id IN (:...ids)', { ids: [...new Set(entries.map((entry) => entry.id))] })
        .getRawMany()
      const fingerprints = new Map(rows.map((row) => [`${row.userId}:${row.id}`, JSON.stringify([row.revision, row.title, row.taskId, row.taskStatus, row.taskUpdated])]))
      for (const entry of entries) {
        const fingerprint = fingerprints.get(`${entry.userId}:${entry.id}`) ?? 'deleted'
        if (entry.fingerprint !== fingerprint) {
          entry.fingerprint = fingerprint
          this.changed(entry.userId, entry.id)
        }
      }
    } finally {
      this.watching = false
    }
  }

  setAccess(access: ResourceAccessRegistry) {
    this.access = access
  }

  async save(session: ChatSession, lease?: { taskId: string, owner: string }) {
    if (!session.userId) {
      return
    }
    const id = (session.conversationId ||= randomUUID())
    if (session.active) {
      this.active.add(id)
    } else {
      this.active.delete(id)
    }
    const state = {
      messages: session.messages,
      history: session.history,
      contextState: session.contextState,
      branch: session.branch,
      messageCommands: session.messageCommands,
      answerRetryEvidence: session.answerRetryEvidence,
      scopeBindings: session.scopeBindings,
      configurationKey: session.configurationKey,
      mode: session.mode,
      requests: [...session.requests],
      calls: [...session.calls],
      interrupted: !!session.active,
    }
    const title = (
      session.branch && session.title
        ? session.title
        : session.messages.find((m) => m.role === 'user')?.content || '新对话'
    ).slice(0, 60)
    const refs = uniqueResources([
      ...this.access.references(session.messages),
      ...(session.branch?.resourceRefs || []),
    ])
    // Lock conversation first, then the task, matching admission/deletion lock order.
    // New IDs have no row to lock: READ COMMITTED avoids mutually blocking gap
    // locks during concurrent first saves. Existing rows still lock, and revision,
    // ownership, unique ID and task-lease checks remain authoritative.
    const revision = await this.source.transaction(
      'READ COMMITTED',
      async (db) => {
        const row = await db.getRepository(ConversationEntity).findOne({
          select: { user_id: true, revision: true, title: true },
          where: { id },
          lock: { mode: 'pessimistic_write' },
        })
        if (lease) {
          const [task] = await db
            .createQueryBuilder()
            .select('lease_owner,status,lease_until>=UTC_TIMESTAMP(3) AS valid')
            .from('agent_tasks', 'agent_tasks')
            .where('id=:p0 AND user_id=:p1 AND conversation_id=:p2')
            .setLock('pessimistic_write')
            .setParameters({ p0: lease.taskId, p1: session.userId, p2: id })
            .getRawMany()
          if (
            !task ||
            task.lease_owner !== lease.owner ||
            task.status !== 'running' ||
            !task.valid
          ) {
            throw ErrorCode.TASK_LEASE_LOST('任务租约已失效，不能覆盖会话记录')
          }
        } else {
          const running = await db.getRepository(AgentTaskEntity).find({
            select: { id: true },
            where: { active_key: id, status: 'running' },
            lock: { mode: 'pessimistic_write' },
          })
          if (running.length) {
            throw ErrorCode.CONVERSATION_BUSY()
          }
        }
        if (row) {
          if (
            row.user_id !== session.userId ||
            Number(row.revision) !== session.archiveRevision
          ) {
            throw ErrorCode.CONVERSATION_STALE()
          }
          // Store the replaced answer and publish its replacement in the same transaction.
          if (session.pendingAnswerVersion) {
            const version = session.pendingAnswerVersion
            await db
              .createQueryBuilder()
              .insert()
              .into('conversation_answer_versions')
              .values({
                conversation_id: id,
                message_id: version.message.id,
                replacement_request_id: version.requestId,
                revision: version.message.answerRevision || 0,
                snapshot_json: () => ':p4',
              })
              .updateEntity(false)
              .orIgnore()
              .setParameters({
                p4: JSON.stringify({
                  message: version.message,
                  calls: version.calls,
                }),
              })
              .execute()
          }
          await db.getRepository(ConversationEntity).update(
            { id, user_id: session.userId },
            {
              state_json: JSON.stringify(state),
              resource_refs: refs,
              message_count: session.messages.length,
              revision: () => 'revision+1',
              updated_at: () => 'UTC_TIMESTAMP(3)',
            },
          )
          session.title = row.title
          await this.memory?.saved(db, session)
          return Number(row.revision) + 1
        }
        if (session.archived) {
          throw ErrorCode.CONVERSATION_NOT_FOUND('会话已删除，请新建会话')
        }
        await db.getRepository(ConversationEntity).insert({
          id,
          user_id: session.userId,
          title,
          title_source: session.branch ? 'generated' : 'pending',
          state_json: JSON.stringify(state),
          resource_refs: refs,
          message_count: session.messages.length,
        })
        await this.memory?.saved(db, session)
        if (session.pendingAnswerVersion) {
          const version = session.pendingAnswerVersion
          await db
            .createQueryBuilder()
            .insert()
            .into('conversation_answer_versions')
            .values({
              conversation_id: id,
              message_id: version.message.id,
              replacement_request_id: version.requestId,
              revision: version.message.answerRevision || 0,
              snapshot_json: () => ':p4',
            })
            .updateEntity(false)
            .orIgnore()
            .setParameters({
              p4: JSON.stringify({
                message: version.message,
                calls: version.calls,
              }),
            })
            .execute()
        }
        session.title = title
        return 1
      },
    )
    session.archived = true
    session.archiveRevision = revision
    this.changed(session.userId, id)
    delete session.pendingAnswerVersion
  }

  async load(
    principal: Actor,
    id: string,
    trustedRefresh = false,
  ): Promise<Saved> {
    const row = await this.source
      .getRepository(ConversationEntity)
      .findOne({
        select: {
          state_json: true,
          resource_refs: true,
          revision: true,
          title: true,
        },
        where: { id: parseId(id), user_id: principal.user.id },
      })
      .then((row) =>
        row
          ? {
              state: row.state_json,
              resourceRefs: row.resource_refs,
              revision: row.revision,
              title: row.title,
            }
          : null,
      )
    if (!row) {
      throw ErrorCode.CONVERSATION_NOT_FOUND()
    }
    const refs: ResourceRef[] =
      typeof row.resourceRefs === 'string'
        ? JSON.parse(row.resourceRefs)
        : row.resourceRefs
    for (const ref of refs) {
      // Internal refresh only stages data in the authenticated server session.
      // Membership is mandatory; the runner requests fresh grants before model input/snapshot.
      if (trustedRefresh) {
        await this.access.inspect(principal, ref, 'read', '继续会话')
      } else {
        await this.access.ensure(principal, ref)
      }
    }
    return {
      ...JSON.parse(row.state),
      archiveRevision: Number(row.revision),
      title: row.title,
    }
  }

  async restore(
    principal: Actor,
    id: string,
    session: ChatSession,
    trustedRefresh = false,
    running = false,
  ) {
    const saved = await this.load(principal, id, trustedRefresh)
    Object.assign(session, {
      ...saved,
      requests: new Map(saved.requests) as ChatSession['requests'],
      calls: new Map(saved.calls) as ChatSession['calls'],
      conversationId: id,
      archived: true,
    })
    if (saved.interrupted && !running) {
      session.rebuildHistory = true
      for (const message of session.messages) {
        for (const tool of message.toolCalls) {
          if (['running', 'waiting_client'].includes(tool.status)) {
            tool.status = 'failed'
            tool.summary = '任务已中断，请核对已完成的操作，不会自动重试。'
          }
        }
      }
      for (const message of session.messages) {
        if (message.outcome === 'running') {
          message.outcome = 'paused'
        }
        for (const item of message.timeline || []) {
          if (item.kind === 'tool') {
            const tool = message.toolCalls.find((x) => x.id === item.tool.id)
            if (tool) {
              item.tool = { ...tool }
            }
          } else if (item.status === 'streaming') {
            item.status = 'interrupted'
          }
          item.revision++
        }
      }
      const last = session.messages.at(-1)
      if (last?.role === 'assistant') {
        last.content +=
          '\n此任务曾中断，请核对工具结果后继续，不会自动重试写入。'
      }
      // Incomplete call batches are invalid provider input. Preserve visible history;
      // resume reasoning from plain conversation messages after interruption.
      session.history = session.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))
    }
  }

  async list(principal: Actor): Promise<ConversationSummary[]> {
    const rows = await this.source
      .getRepository(ConversationEntity)
      .find({
        select: {
          id: true,
          title: true,
          updated_at: true,
          message_count: true,
          resource_refs: true,
        },
        where: { user_id: principal.user.id },
        order: { updated_at: 'DESC', id: 'DESC' },
        take: 100,
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          title: row.title,
          updatedAt: row.updated_at,
          messageCount: row.message_count,
          resourceRefs: row.resource_refs,
        })),
      )
    return Promise.all(
      rows.map(async (row) => {
        const refs: ResourceRef[] =
          typeof row.resourceRefs === 'string'
            ? JSON.parse(row.resourceRefs)
            : row.resourceRefs
        const protectedResources: ResourceRef[] = []
        let unavailable = false
        for (const ref of refs) {
          try {
            const inspection = await this.access.inspect(
              principal,
              ref,
              'read',
              '打开历史会话',
            )
            if (inspection.challenge) {
              protectedResources.push(ref)
            }
          } catch {
            unavailable = true
          }
        }
        return {
          id: row.id,
          title:
            protectedResources.length || unavailable
              ? '受保护的会话'
              : row.title,
          updatedAt: isoTime(row.updatedAt),
          messageCount: Number(row.messageCount),
          protectedResources,
          unavailable,
        }
      }),
    )
  }

  async getTitle(principal: Actor, id: string): Promise<string> {
    return (await this.load(principal, id)).title
  }

  async needsTitle(principal: Actor, id: string): Promise<boolean> {
    const row = await this.source.getRepository(ConversationEntity).findOne({
      select: { title_source: true },
      where: { id: parseId(id), user_id: principal.user.id },
    })
    return row?.title_source === 'pending'
  }

  async setGeneratedTitle(
    principal: Actor,
    id: string,
    title: string,
  ): Promise<string> {
    const result = await this.source.transaction(async (db) => {
      const row = await db.getRepository(ConversationEntity).findOne({
        select: { title: true, title_source: true },
        where: { id: parseId(id), user_id: principal.user.id },
        lock: { mode: 'pessimistic_write' },
      })
      if (!row) {
        throw ErrorCode.CONVERSATION_NOT_FOUND()
      }
      // A concurrent manual rename wins. Title metadata never changes the execution revision.
      if (row.title_source !== 'pending') {
        return row.title
      }
      await db
        .getRepository(ConversationEntity)
        .update(
          { id, user_id: principal.user.id },
          { title, title_source: 'generated' },
        )
      return title
    })
    this.changed(principal.user.id, id)
    return result
  }

  async rename(principal: Actor, id: string, value: unknown) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => k !== 'title')
    ) {
      throw ErrorCode.INVALID_TITLE()
    }
    const title = (value as { title?: unknown }).title
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      [...title.trim()].length > 60 ||
      // eslint-disable-next-line no-control-regex -- Conversation titles must not contain control characters.
      /[\u0000-\u001F]/u.test(title)
    ) {
      throw ErrorCode.INVALID_TITLE('标题需为1至60个字符，不能包含换行')
    }
    await this.load(principal, id) // Same ownership and resource grants as opening the conversation.
    const changed = await this.source
      .getRepository(ConversationEntity)
      .update(
        { id: parseId(id), user_id: principal.user.id },
        { title: title.trim(), title_source: 'manual' },
      )
    if (!changed.affected) {
      throw ErrorCode.CONVERSATION_NOT_FOUND()
    }
    this.changed(principal.user.id, id)
    return { id, title: title.trim() }
  }

  async exists(principal: Actor, id: string): Promise<boolean> {
    const rows = await this.source.getRepository(ConversationEntity).find({
      select: { id: true },
      where: { id: parseId(id), user_id: principal.user.id },
    })
    return !!rows.length
  }

  async remove(principal: Actor, id: string) {
    if (this.active.has(parseId(id))) {
      throw ErrorCode.CONVERSATION_BUSY('请先停止此会话正在执行的任务')
    }
    await this.source.transaction(async (db) => {
      const rows = await db.getRepository(ConversationEntity).find({
        select: { id: true },
        where: { id: parseId(id), user_id: principal.user.id },
        lock: { mode: 'pessimistic_write' },
      })
      if (!rows.length) {
        return
      }
      const tasks = await db.getRepository(AgentTaskEntity).find({
        select: { id: true },
        where: {
          conversation_id: id,
          user_id: principal.user.id,
          status: Not(In(['completed', 'cancelled'])),
        },
        lock: { mode: 'pessimistic_write' },
      })
      if (tasks.length) {
        throw ErrorCode.CONVERSATION_BUSY('请先继续或结束此会话的待处理任务')
      }
      await db
        .getRepository(AgentTaskEntity)
        .delete({ conversation_id: id, user_id: principal.user.id })
      await db
        .getRepository(ConversationEntity)
        .delete({ id, user_id: principal.user.id })
      await this.memory?.removed(db, principal.user.id, id)
    })
    this.changed(principal.user.id, id)
  }
}
