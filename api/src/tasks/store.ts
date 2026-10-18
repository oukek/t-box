import type { TaskStatus, TaskSummary, TaskToolRecord } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { Actor, TaskPort, ToolJournal } from '../agent/contracts.js'
import type { StoredAgentTask } from '../db/records/tasks-entities.js'
import { createHash } from 'node:crypto'
import { isoTime } from '@t-box/server-foundation/time'
import { In, IsNull, Raw } from 'typeorm'
import { parseToolResult } from '../agent/tool-result-schema.js'
import { ConversationEntity } from '../db/records/conversations-entities.js'
import {
  AgentTaskEntity,
  AgentTaskToolEntity,
} from '../db/records/tasks-entities.js'
import { ErrorCode } from '../error-codes.js'

const hash = (call: { name: string, arguments: string }) =>
  createHash('sha256').update(`${call.name}:${call.arguments}`).digest('hex')
const executionKey = (key?: string) =>
  key ? createHash('sha256').update(key).digest('hex') : null
const uncertain = (effect: string) => ['write', 'external'].includes(effect)
const decode = (value: unknown): unknown =>
  typeof value === 'string' ? JSON.parse(value) : value
/** MySQL owns execution leases/checkpoints; UI waits release leases until an authenticated client returns. */
export class TaskStore implements TaskPort {
  constructor(readonly source: DataSource) {}
  private recovery?: Promise<void>
  recover(): Promise<void> {
    // Share one sweep per store; other workers still use guarded primary-key updates.
    if (this.recovery) {
      return this.recovery
    }
    this.recovery = this.recoverExpired().finally(() => {
      this.recovery = undefined
    })
    return this.recovery
  }

  private async recoverExpired() {
    const exhausted: { id: string }[] = await this.source
      .createQueryBuilder()
      .select('id')
      .from('agent_tasks', 'agent_tasks')
      .where(
        'recovery_ready=TRUE AND recovery_attempts>=5\n      AND status IN (\'queued\',\'paused\') AND (recovery_claim_until IS NULL OR recovery_claim_until<UTC_TIMESTAMP(3))',
      )
      .limit(256)
      .getRawMany()
    for (const { id } of exhausted) {
      await this.source
        .createQueryBuilder()
        .update('agent_tasks')
        .set({
          recovery_ready: false,
          recovery_claim: null,
          recovery_claim_until: null,
          status: 'paused',
          reason: '自动恢复尝试已达上限，请打开会话核对后继续',
          updated_at: () => 'UTC_TIMESTAMP(3)',
        })
        .updateEntity(false)
        .where(
          'id=:p0 AND recovery_ready=TRUE AND recovery_attempts>=5 AND status IN (\'queued\',\'paused\')\n        AND (recovery_claim_until IS NULL OR recovery_claim_until<UTC_TIMESTAMP(3))',
        )
        .setParameters({ p0: id })
        .execute()
    }
    // A range UPDATE takes InnoDB next-key locks even when no lease has expired.
    // Read candidates without locks, then fence each update by its current lease.
    // Bound each sweep so recovery cannot monopolize admission on a large backlog.
    const rows: { id: string }[] = await this.source
      .getRepository(AgentTaskEntity)
      .find({
        select: { id: true },
        where: {
          status: 'running',
          lease_until: Raw((column) => `${column} < UTC_TIMESTAMP(3)`),
        },
        order: { lease_until: 'ASC', id: 'ASC' },
        take: 256,
      })
    for (const { id } of rows) {
      // Never replay a possibly committed write or external request after expiry.
      // native-sql: atomic correlated update fenced against concurrent task/category changes
      await this.source.query(
        `UPDATE agent_tasks t SET
      status=IF(EXISTS(SELECT 1 FROM agent_task_tools x WHERE x.task_id=t.id AND x.effect IN ('write','external') AND x.status IN ('dispatched','uncertain')), 'needs_review', IF(cancel_requested,'cancelled','paused')),
      active_key=IF(cancel_requested AND NOT EXISTS(SELECT 1 FROM agent_task_tools x WHERE x.task_id=t.id AND x.effect IN ('write','external') AND x.status IN ('dispatched','uncertain')),NULL,active_key),
      recovery_ready=NOT cancel_requested AND recovery_auth_hash IS NOT NULL AND recovery_attempts<5
        AND NOT EXISTS(SELECT 1 FROM agent_task_tools x WHERE x.task_id=t.id AND x.effect IN ('write','external') AND x.status IN ('dispatched','uncertain')),
      recovery_after=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 2 SECOND),recovery_claim=NULL,recovery_claim_until=NULL,
      reason='服务执行已中断，已完成的操作保留',lease_owner=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(3)
      WHERE id=? AND status='running' AND lease_until < UTC_TIMESTAMP(3)`,
        [id],
      )
    }
  }

  async create(
    actor: Actor,
    id: string,
    conversationId: string,
    requestId: string,
    checkpoint: unknown,
    agentId: string,
    existingConversation = false,
    archiveRevision?: number,
  ) {
    await this.recover()
    try {
      await this.source.transaction(async (db) => {
        if (existingConversation) {
          const row = await db.getRepository(ConversationEntity).findOne({
            select: { id: true, revision: true },
            where: { id: conversationId, user_id: actor.user.id },
            lock: { mode: 'pessimistic_write' },
          })
          if (!row) {
            throw ErrorCode.CONVERSATION_NOT_FOUND('会话已删除，任务未执行')
          }
          if (
            archiveRevision !== undefined &&
            Number(row.revision) !== archiveRevision
          ) {
            throw ErrorCode.CONVERSATION_STALE(
              '会话已在其他连接更新，请重新连接后继续',
            )
          }
        }
        await db.getRepository(AgentTaskEntity).insert({
          id,
          user_id: actor.user.id,
          conversation_id: conversationId,
          request_id: requestId,
          status: 'queued',
          active_key: conversationId,
          agent_id: agentId,
          checkpoint_json: JSON.stringify(checkpoint),
          recovery_auth_hash: actor.sessionHash,
          recovery_ready: true,
          recovery_after: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND)',
        })
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw ErrorCode.TASK_IN_PROGRESS(
          '此会话已有待处理任务，请继续或结束该任务',
        )
      }
      throw error
    }
  }

  async claim(actor: Actor, id: string, owner: string, recoveryClaim?: string) {
    await this.recover()
    const claim = this.source
      .createQueryBuilder()
      .update('agent_tasks')
      .set({
        status: 'running',
        reason: null,
        lease_owner: owner,
        lease_until: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND)',
        recovery_auth_hash: actor.sessionHash,
        recovery_ready: false,
        recovery_claim: null,
        recovery_claim_until: null,
        updated_at: () => 'UTC_TIMESTAMP(3)',
      })
      .where(
        'id=:id AND user_id=:userId AND status IN (\'queued\',\'paused\',\'waiting_client\') AND cancel_requested=FALSE',
        { id, userId: actor.user.id },
      )
    if (recoveryClaim) {
      claim.andWhere(
        'recovery_ready=TRUE AND recovery_claim=:recoveryClaim AND recovery_claim_until>=UTC_TIMESTAMP(3)',
        { recoveryClaim },
      )
    }
    const result = await claim.execute()
    if (!result.affected) {
      throw ErrorCode.TASK_NOT_RESUMABLE(
        '任务正在执行、已结束或需要核对，不能重复运行',
      )
    }
  }

  async guard(id: string, owner: string) {
    const result = await this.source.getRepository(AgentTaskEntity).update(
      {
        id,
        lease_owner: owner,
        status: 'running',
        cancel_requested: false,
        lease_until: Raw((column) => `${column} >= UTC_TIMESTAMP(3)`),
      },
      { lease_until: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND)' },
    )
    if (!result.affected) {
      const task = await this.source.getRepository(AgentTaskEntity).findOne({
        select: { cancel_requested: true },
        where: { id, lease_owner: owner },
      })
      if (task?.cancel_requested) {
        throw ErrorCode.TASK_CANCELLED()
      }
      throw ErrorCode.TASK_LEASE_LOST('任务已停止或执行租约失效')
    }
  }

  async checkpoint(id: string, owner: string, value: unknown, agentId: string) {
    const serialized = JSON.stringify(value)
    if (serialized.length > 2_000_000) {
      throw ErrorCode.TASK_STATE_LIMIT()
    }
    const result = await this.source.getRepository(AgentTaskEntity).update(
      {
        id,
        lease_owner: owner,
        status: 'running',
        lease_until: Raw((column) => `${column} >= UTC_TIMESTAMP(3)`),
      },
      {
        checkpoint_json: serialized,
        agent_id: agentId,
        updated_at: () => 'UTC_TIMESTAMP(3)',
      },
    )
    if (!result.affected) {
      throw ErrorCode.TASK_LEASE_LOST('任务执行租约已失效')
    }
  }

  async finish(
    id: string,
    owner: string,
    status: TaskStatus,
    reason?: string,
    execution?: import('@t-box/shared').MessageExecution,
    recoverAfterShutdown = false,
    result?: import('@t-box/shared').ChatMessage,
  ) {
    const terminal = ['completed', 'cancelled'].includes(status)
    // native-sql: atomic correlated update fenced against concurrent task/category changes
    await this.source.query(
      `UPDATE agent_tasks t SET
      status=IF(EXISTS(SELECT 1 FROM agent_task_tools x WHERE x.task_id=t.id AND x.effect IN ('write','external') AND x.status IN ('dispatched','uncertain')),'needs_review',IF(cancel_requested,'cancelled',?)),
      active_key=IF((? OR cancel_requested) AND NOT EXISTS(SELECT 1 FROM agent_task_tools x WHERE x.task_id=t.id AND x.effect IN ('write','external') AND x.status IN ('dispatched','uncertain')),NULL,active_key),
      checkpoint_json=JSON_SET(IF(? IS NULL,checkpoint_json,JSON_SET(checkpoint_json,'$.execution',JSON_EXTRACT(?,'$'))),
        '$.auditResult',JSON_EXTRACT(?,'$')),
      recovery_ready=? AND ?='paused' AND NOT cancel_requested AND recovery_auth_hash IS NOT NULL AND recovery_attempts<5
        AND NOT EXISTS(SELECT 1 FROM agent_task_tools x WHERE x.task_id=t.id AND x.effect IN ('write','external') AND x.status IN ('dispatched','uncertain')),
      recovery_after=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 2 SECOND),recovery_claim=NULL,recovery_claim_until=NULL,
      reason=?,lease_owner=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_owner=? AND status='running'`,
      [
        status,
        terminal,
        execution ? JSON.stringify(execution) : null,
        execution ? JSON.stringify(execution) : null,
        result
          ? JSON.stringify({
              id: result.id,
              role: result.role,
              content: result.content,
              error: result.error,
              attachments: result.attachments?.map((r) => ({
                id: r.id,
                name: r.name,
                mimeType: r.mimeType,
              })),
            })
          : 'null',
        recoverAfterShutdown,
        status,
        reason?.slice(0, 200) || null,
        id,
        owner,
      ],
    )
  }

  /** Reserve a preparation slot without executing anything; abandoned preparations expire. */
  async takeRecovery(claim: string): Promise<
    | {
      id: string
      userId: string
      conversationId: string
      sessionHash: string
    } |
    undefined
  > {
    await this.recover()
    return this.source.transaction('READ COMMITTED', async (db) => {
      const [row] = await db
        .createQueryBuilder()
        .select('id,user_id,conversation_id,recovery_auth_hash')
        .from('agent_tasks', 'agent_tasks')
        .where(
          'recovery_ready=TRUE AND status IN (\'queued\',\'paused\') AND cancel_requested=FALSE\n          AND recovery_attempts<5 AND recovery_after<=UTC_TIMESTAMP(3)\n          AND (recovery_claim_until IS NULL OR recovery_claim_until<UTC_TIMESTAMP(3))\n          AND NOT EXISTS(SELECT 1 FROM agent_task_tools x WHERE x.task_id=agent_tasks.id AND x.effect IN (\'write\',\'external\') AND x.status IN (\'dispatched\',\'uncertain\'))',
        )
        .orderBy('recovery_after', 'ASC')
        .addOrderBy('id', 'ASC')
        .limit(1)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getRawMany()
      if (!row) {
        return undefined
      }
      await db.getRepository(AgentTaskEntity).update(
        { id: row.id },
        {
          recovery_claim: claim,
          recovery_claim_until: () =>
            'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND)',
          recovery_attempts: () => 'recovery_attempts+1',
        },
      )
      return {
        id: row.id,
        userId: row.user_id,
        conversationId: row.conversation_id,
        sessionHash: row.recovery_auth_hash,
      }
    })
  }

  async stopRecovery(
    id: string,
    claim: string,
    waitingClient: boolean,
    reason: string,
  ) {
    await this.source.getRepository(AgentTaskEntity).update(
      { id, recovery_claim: claim, status: In(['queued', 'paused']) },
      {
        recovery_ready: false,
        recovery_claim: null,
        recovery_claim_until: null,
        status: waitingClient ? 'waiting_client' : 'paused',
        reason: reason.slice(0, 200),
        updated_at: () => 'UTC_TIMESTAMP(3)',
      },
    )
  }

  private summary(
    row: Pick<
      StoredAgentTask,
      'id' | 'conversation_id' | 'status' | 'agent_id' | 'updated_at' | 'reason'
    >,
  ): TaskSummary {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      status: row.status,
      agentId: row.agent_id,
      updatedAt: isoTime(row.updated_at),
      ...(row.reason ? { reason: row.reason } : {}),
    }
  }

  async get(
    actor: Actor,
    id: string,
  ): Promise<{
    summary: TaskSummary
    checkpoint: unknown
    tools: TaskToolRecord[]
  }> {
    await this.recover()
    const row = await this.source.getRepository(AgentTaskEntity).findOne({
      select: {
        id: true,
        user_id: true,
        conversation_id: true,
        request_id: true,
        status: true,
        active_key: true,
        agent_id: true,
        checkpoint_json: true,
        lease_owner: true,
        lease_until: true,
        cancel_requested: true,
        reason: true,
        created_at: true,
        updated_at: true,
        recovery_auth_hash: true,
        recovery_ready: true,
        recovery_attempts: true,
        recovery_after: true,
        recovery_claim: true,
        recovery_claim_until: true,
      },
      where: { id, user_id: actor.user.id },
    })
    if (!row) {
      throw ErrorCode.TASK_NOT_FOUND()
    }
    const tools = await this.source.getRepository(AgentTaskToolEntity).find({
      select: {
        call_id: true,
        name: true,
        agent_id: true,
        effect: true,
        status: true,
        result_json: true,
      },
      where: { task_id: id },
      order: { updated_at: 'ASC', call_id: 'ASC' },
    })
    return {
      summary: this.summary(row),
      checkpoint: decode(row.checkpoint_json),
      tools: tools.map((x): TaskToolRecord => ({
        callId: x.call_id,
        name: x.name,
        agentId: x.agent_id,
        effect: x.effect,
        status: x.status,
        ...(x.result_json
          ? { result: parseToolResult(decode(x.result_json), 'journal') }
          : {}),
      })),
    }
  }

  async current(actor: Actor, conversationId: string) {
    await this.recover()
    const row = await this.source.getRepository(AgentTaskEntity).findOne({
      select: {
        id: true,
        conversation_id: true,
        status: true,
        agent_id: true,
        updated_at: true,
        reason: true,
      },
      where: { active_key: conversationId, user_id: actor.user.id },
    })
    return row ? this.summary(row) : null
  }

  async list(actor: Actor): Promise<TaskSummary[]> {
    await this.recover()
    const rows = await this.source.getRepository(AgentTaskEntity).find({
      select: {
        id: true,
        conversation_id: true,
        status: true,
        agent_id: true,
        updated_at: true,
        reason: true,
      },
      where: { user_id: actor.user.id },
      order: { updated_at: 'DESC', id: 'ASC' },
      take: 100,
    })
    return rows.map((row) => this.summary(row))
  }

  async cancel(actor: Actor, id: string) {
    await this.recover()
    const result = await this.source.getRepository(AgentTaskEntity).update(
      {
        id,
        user_id: actor.user.id,
        status: In([
          'queued',
          'running',
          'paused',
          'waiting_client',
          'needs_review',
        ]),
      },
      {
        cancel_requested: true,
        status: () => 'IF(status=\'running\',status,\'cancelled\')',
        active_key: () => 'IF(status=\'running\',active_key,NULL)',
        updated_at: () => 'UTC_TIMESTAMP(3)',
      },
    )
    if (!result.affected) {
      throw ErrorCode.TASK_NOT_CANCELLABLE()
    }
  }

  async cancelSuspended(actor: Actor, id: string) {
    await this.recover()
    const result = await this.source.getRepository(AgentTaskEntity).update(
      {
        id,
        user_id: actor.user.id,
        status: In(['paused', 'waiting_client', 'needs_review']),
        lease_owner: IsNull(),
      },
      {
        cancel_requested: true,
        status: 'cancelled',
        active_key: null,
        reason: '用户发送新消息或调整会话，旧任务已结束；实际工具结果仍保留',
        updated_at: () => 'UTC_TIMESTAMP(3)',
      },
    )
    if (!result.affected) {
      throw ErrorCode.TASK_CHANGED()
    }
  }

  journal(id: string, owner: string): ToolJournal {
    return {
      guard: () => this.guard(id, owner),
      lookup: async (call) => {
        await this.guard(id, owner)
        const [row] = await this.source
          .createQueryBuilder()
          .select('call_id,fingerprint,effect,status,result_json')
          .from('agent_task_tools', 'agent_task_tools')
          .where('task_id=:p0 AND (call_id=:p1 OR execution_key=:p2)')
          .orderBy('(call_id=:p3)', 'DESC')
          .limit(1)
          .setParameters({
            p0: id,
            p1: call.id,
            p2: executionKey(call.writeKey),
            p3: call.id,
          })
          .getRawMany()
        if (!row) {
          return undefined
        }
        if (row.call_id === call.id && row.fingerprint !== hash(call)) {
          throw ErrorCode.CALL_ID_CONFLICT('持久工具调用标识冲突')
        }
        if (row.status === 'completed') {
          return parseToolResult(decode(row.result_json), 'journal')
        }
        if (uncertain(row.effect)) {
          throw ErrorCode.TOOL_OUTCOME_UNCERTAIN()
        }
        return undefined
      },
      dispatch: async (call, effect, agentId) => {
        // Lock the task and persist intent in one transaction before dispatching a side effect.
        // The parent row serializes this task's calls; do not gap-lock absent tool
        // receipts across unrelated tasks before their first INSERT.
        await this.source.transaction('READ COMMITTED', async (db) => {
          const [task] = await db
            .createQueryBuilder()
            .select(
              'lease_owner,cancel_requested,status,lease_until>=UTC_TIMESTAMP(3) AS valid',
            )
            .from('agent_tasks', 'agent_tasks')
            .where('id=:p0')
            .setLock('pessimistic_write')
            .setParameters({ p0: id })
            .getRawMany()
          if (
            !task ||
            task.lease_owner !== owner ||
            task.status !== 'running' ||
            task.cancel_requested ||
            !task.valid
          ) {
            throw ErrorCode.TASK_LEASE_LOST('任务已停止或租约失效')
          }
          const [previous] = await db
            .createQueryBuilder()
            .select('fingerprint,effect,status')
            .from('agent_task_tools', 'agent_task_tools')
            .where('task_id=:p0 AND (call_id=:p1 OR execution_key=:p2)')
            .setLock('pessimistic_write')
            .setParameters({
              p0: id,
              p1: call.id,
              p2: executionKey(call.writeKey),
            })
            .getRawMany()
          if (
            previous &&
            (previous.fingerprint !== hash(call) ||
              previous.status === 'completed' ||
              uncertain(previous.effect))
          ) {
            throw ErrorCode.TOOL_ALREADY_DISPATCHED()
          }
          await db
            .createQueryBuilder()
            .insert()
            .into('agent_task_tools')
            .values({
              task_id: () => ':p0',
              call_id: () => ':p1',
              name: () => ':p2',
              agent_id: () => ':p3',
              fingerprint: () => ':p4',
              execution_key: () => ':p5',
              effect: () => ':p6',
              status: () => '\'dispatched\'',
              updated_at: () => 'UTC_TIMESTAMP(3)',
            })
            .updateEntity(false)
            .setParameters({
              p0: id,
              p1: call.id,
              p2: call.name,
              p3: agentId,
              p4: hash(call),
              p5: executionKey(call.writeKey),
              p6: effect,
            })
            .orUpdate(['status', 'updated_at'])
            .execute()
        })
      },
      complete: async (callId, result) => {
        // Cancellation does not prevent an already dispatched operation from recording its outcome.
        const outcome = !result.ok ? 'uncertain' : 'completed'
        const effect = await this.source.transaction(async (db) => {
          // Every journal mutation locks the parent before its tools, matching dispatch/recovery.
          // A multi-table UPDATE can choose the opposite order and deadlock concurrent recovery.
          const [task] = await db
            .createQueryBuilder()
            .select('lease_owner,status,lease_until>=UTC_TIMESTAMP(3) AS valid')
            .from('agent_tasks', 'agent_tasks')
            .where('id=:p0')
            .setLock('pessimistic_write')
            .setParameters({ p0: id })
            .getRawMany()
          if (
            !task ||
            task.lease_owner !== owner ||
            task.status !== 'running' ||
            !task.valid
          ) {
            throw ErrorCode.TASK_LEASE_LOST()
          }
          const resultDB = await db
            .createQueryBuilder()
            .update('agent_task_tools')
            .set({
              result_json: JSON.stringify(result),
              status: () =>
                'IF(effect IN (\'write\',\'external\'),:p1,\'completed\')',
              updated_at: () => 'UTC_TIMESTAMP(3)',
            })
            .updateEntity(false)
            .where('task_id=:p2 AND call_id=:p3')
            .setParameters({ p1: outcome, p2: id, p3: callId })
            .execute()
          if (!resultDB.affected) {
            throw ErrorCode.TASK_LEASE_LOST()
          }
          const row = await db.getRepository(AgentTaskToolEntity).findOne({
            select: { effect: true },
            where: { task_id: id, call_id: callId },
          })
          return row?.effect as string | undefined
        })
        if (!result.ok) {
          if (effect && uncertain(effect)) {
            throw ErrorCode.TOOL_OUTCOME_UNCERTAIN(
              `操作结果未能确认：${result.error.message.slice(0, 140)}；请核对后结束该任务`,
            )
          }
        }
      },
    }
  }
}
