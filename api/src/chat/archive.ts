import type { ConversationSummary, ResourceRef } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { ResourceAccessRegistry } from '../agent/access.js'
import type { Actor } from '../agent/contracts.js'
import type { ChatSession } from './session.js'
import { randomUUID } from 'node:crypto'
import { parseId } from '@t-box/ledger-server/validation'
import { ApiError } from '@t-box/server-foundation/errors'
import { isoTime } from '@t-box/server-foundation/time'
import {
  uniqueResources,
} from '@t-box/shared'

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
  constructor(
    readonly source: DataSource,
    private access: ResourceAccessRegistry,
  ) {}

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
        const [row] = await db.query(
          'SELECT user_id,revision,title FROM conversations WHERE id=? FOR UPDATE',
          [id],
        )
        if (lease) {
          const [task] = await db.query(
            'SELECT lease_owner,status,lease_until>=UTC_TIMESTAMP(3) AS valid FROM agent_tasks WHERE id=? AND user_id=? AND conversation_id=? FOR UPDATE',
            [lease.taskId, session.userId, id],
          )
          if (
            !task ||
            task.lease_owner !== lease.owner ||
            task.status !== 'running' ||
            !task.valid
          ) {
            throw new ApiError(
              409,
              'TASK_LEASE_LOST',
              '任务租约已失效，不能覆盖会话记录',
            )
          }
        } else {
          const running = await db.query(
            'SELECT id FROM agent_tasks WHERE active_key=? AND status=\'running\' FOR UPDATE',
            [id],
          )
          if (running.length) {
            throw new ApiError(
              409,
              'CONVERSATION_BUSY',
              '任务正在执行，不能覆盖会话记录',
            )
          }
        }
        if (row) {
          if (
            row.user_id !== session.userId ||
            Number(row.revision) !== session.archiveRevision
          ) {
            throw new ApiError(
              409,
              'CONVERSATION_STALE',
              '会话已更新，请重新连接，已执行的操作保留',
            )
          }
          // Store the replaced answer and publish its replacement in the same transaction.
          if (session.pendingAnswerVersion) {
            const version = session.pendingAnswerVersion
            await db.query(
              'INSERT IGNORE INTO conversation_answer_versions(conversation_id,message_id,replacement_request_id,revision,snapshot_json) VALUES(?,?,?,?,?)',
              [
                id,
                version.message.id,
                version.requestId,
                version.message.answerRevision || 0,
                JSON.stringify({
                  message: version.message,
                  calls: version.calls,
                }),
              ],
            )
          }
          await db.query(
            'UPDATE conversations SET state_json=?,resource_refs=?,message_count=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND user_id=?',
            [
              JSON.stringify(state),
              JSON.stringify(refs),
              session.messages.length,
              id,
              session.userId,
            ],
          )
          session.title = row.title
          return Number(row.revision) + 1
        }
        if (session.archived) {
          throw new ApiError(
            404,
            'CONVERSATION_NOT_FOUND',
            '会话已删除，请新建会话',
          )
        }
        await db.query(
          'INSERT INTO conversations(id,user_id,title,title_source,state_json,resource_refs,message_count) VALUES(?,?,?,?,?,?,?)',
          [
            id,
            session.userId,
            title,
            session.branch ? 'generated' : 'pending',
            JSON.stringify(state),
            JSON.stringify(refs),
            session.messages.length,
          ],
        )
        if (session.pendingAnswerVersion) {
          const version = session.pendingAnswerVersion
          await db.query(
            'INSERT IGNORE INTO conversation_answer_versions(conversation_id,message_id,replacement_request_id,revision,snapshot_json) VALUES(?,?,?,?,?)',
            [
              id,
              version.message.id,
              version.requestId,
              version.message.answerRevision || 0,
              JSON.stringify({
                message: version.message,
                calls: version.calls,
              }),
            ],
          )
        }
        session.title = title
        return 1
      },
    )
    session.archived = true
    session.archiveRevision = revision
    delete session.pendingAnswerVersion
  }

  async load(
    principal: Actor,
    id: string,
    trustedRefresh = false,
  ): Promise<Saved> {
    const [row] = await this.source.query(
      'SELECT state_json AS state,resource_refs AS resourceRefs,revision,title FROM conversations WHERE id=? AND user_id=?',
      [parseId(id), principal.user.id],
    )
    if (!row) {
      throw new ApiError(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
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
  ) {
    const saved = await this.load(principal, id, trustedRefresh)
    Object.assign(session, {
      ...saved,
      requests: new Map(saved.requests) as ChatSession['requests'],
      calls: new Map(saved.calls) as ChatSession['calls'],
      conversationId: id,
      archived: true,
    })
    if (saved.interrupted) {
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
    const rows = await this.source.query(
      'SELECT id,title,updated_at AS updatedAt,message_count AS messageCount,resource_refs AS resourceRefs FROM conversations WHERE user_id=? ORDER BY updated_at DESC,id DESC LIMIT 100',
      [principal.user.id],
    )
    return Promise.all(
      rows.map(async (row: any) => {
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
    const [row] = await this.source.query(
      'SELECT title_source FROM conversations WHERE id=? AND user_id=?',
      [parseId(id), principal.user.id],
    )
    return row?.title_source === 'pending'
  }

  async setGeneratedTitle(
    principal: Actor,
    id: string,
    title: string,
  ): Promise<string> {
    return this.source.transaction(async (db) => {
      const [row] = await db.query(
        'SELECT title,title_source FROM conversations WHERE id=? AND user_id=? FOR UPDATE',
        [parseId(id), principal.user.id],
      )
      if (!row) {
        throw new ApiError(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
      }
      // A concurrent manual rename wins. Title metadata never changes the execution revision.
      if (row.title_source !== 'pending') {
        return row.title
      }
      await db.query(
        'UPDATE conversations SET title=?,title_source=\'generated\' WHERE id=? AND user_id=?',
        [title, id, principal.user.id],
      )
      return title
    })
  }

  async rename(principal: Actor, id: string, value: unknown) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => k !== 'title')
    ) {
      throw new ApiError(400, 'INVALID_TITLE', '请填写会话标题')
    }
    const title = (value as { title?: unknown }).title
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      [...title.trim()].length > 60 ||
      // eslint-disable-next-line no-control-regex -- Conversation titles must not contain control characters.
      /[\u0000-\u001F]/u.test(title)
    ) {
      throw new ApiError(
        400,
        'INVALID_TITLE',
        '标题需为1至60个字符，不能包含换行',
      )
    }
    await this.load(principal, id) // Same ownership and resource grants as opening the conversation.
    const changed = await this.source.query(
      'UPDATE conversations SET title=?,title_source=\'manual\' WHERE id=? AND user_id=?',
      [title.trim(), parseId(id), principal.user.id],
    )
    if (!changed.affectedRows) {
      throw new ApiError(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
    }
    return { id, title: title.trim() }
  }

  async exists(principal: Actor, id: string): Promise<boolean> {
    const rows = await this.source.query(
      'SELECT 1 FROM conversations WHERE id=? AND user_id=?',
      [parseId(id), principal.user.id],
    )
    return !!rows.length
  }

  async remove(principal: Actor, id: string) {
    if (this.active.has(parseId(id))) {
      throw new ApiError(
        409,
        'CONVERSATION_BUSY',
        '请先停止此会话正在执行的任务',
      )
    }
    await this.source.transaction(async (db) => {
      const rows = await db.query(
        'SELECT id FROM conversations WHERE id=? AND user_id=? FOR UPDATE',
        [parseId(id), principal.user.id],
      )
      if (!rows.length) {
        return
      }
      const tasks = await db.query(
        'SELECT id FROM agent_tasks WHERE conversation_id=? AND user_id=? AND status NOT IN (\'completed\',\'cancelled\') FOR UPDATE',
        [id, principal.user.id],
      )
      if (tasks.length) {
        throw new ApiError(
          409,
          'CONVERSATION_BUSY',
          '请先继续或结束此会话的待处理任务',
        )
      }
      await db.query(
        'DELETE FROM agent_tasks WHERE conversation_id=? AND user_id=?',
        [id, principal.user.id],
      )
      await db.query('DELETE FROM conversations WHERE id=? AND user_id=?', [
        id,
        principal.user.id,
      ])
    })
  }
}
