import type {
  OperationsEvent,
  OperationsOverview,
  OperationsTaskDetail,
} from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { StoredAgentTask } from '../db/records/tasks-entities.js'
import type { AuditMessage } from './audit-checkpoint.js'
import { randomUUID } from 'node:crypto'
import { isoTime } from '@t-box/server-foundation/time'
import { decimal } from '../billing/money.js'
import { BillingUsageEntity } from '../db/records/billing-entities.js'
import { OperationsEventEntity } from '../db/records/operations-entities.js'
import { AgentTaskToolEntity } from '../db/records/tasks-entities.js'
import { ErrorCode } from '../error-codes.js'
import { auditPayload } from '../models/audit.js'
import { auditCheckpoint } from './audit-checkpoint.js'
import { ModelOperations } from './model-calls.js'
import { jsonValue } from './queries.js'

/** Overview/events contain metadata only; authorized detail endpoints use sanitized model-call audits. */
export class OperationsService {
  constructor(readonly source: DataSource) {}
  tasks(query: unknown) {
    return new ModelOperations(this.source).tasks(query)
  }

  calls(query: unknown) {
    return new ModelOperations(this.source).calls(query)
  }

  call(id: string) {
    return new ModelOperations(this.source).call(id)
  }

  async record(event: Omit<OperationsEvent, 'id' | 'createdAt'>) {
    await this.source.getRepository(OperationsEventEntity).insert({
      id: randomUUID(),
      kind: event.kind,
      code: event.code.slice(0, 80),
      request_id: event.requestId?.slice(0, 100) || null,
      task_id: event.taskId || null,
      stage: event.stage?.slice(0, 32) || null,
      agent_id: event.agentId?.slice(0, 100) || null,
      http_status: event.httpStatus || null,
      duration_ms:
        event.durationMs == null
          ? null
          : Math.max(0, Math.min(2147483647, Math.round(event.durationMs))),
      provider_request_id: event.providerRequestId?.slice(0, 256) || null,
    })
  }

  async overview(): Promise<OperationsOverview> {
    const [tasks, usage, resources, errors, recovery, payments] =
      await Promise.all([
        this.source
          .createQueryBuilder()
          .select('status')
          .addSelect('COUNT(*)', 'count')
          .from('agent_tasks', 'tasks')
          .where('updated_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)')
          .groupBy('status')
          .getRawMany<{ status: string, count: string | number }>(),
        this.source
          .createQueryBuilder()
          .select(
            'COUNT(*) AS calls,COALESCE(SUM(fee_micro),0) AS cost,COALESCE(SUM(charged_micro),0) AS charged,\n        SUM(status IN (\'reserved\',\'review\')) AS unresolved',
          )
          .from('billing_usage', 'billing_usage')
          .where('created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)')
          .getRawOne<{
          calls: string | number
          cost: string
          charged: string
          unresolved: string | number | null
        }>(),
        this.source
          .createQueryBuilder()
          .select('COUNT(*) AS files,COALESCE(SUM(size),0) AS bytes')
          .from('resources', 'resources')
          .where('deleted_at IS NULL')
          .getRawOne<{ files: string | number, bytes: string | number }>(),
        this.source
          .createQueryBuilder()
          .select('COUNT(*) AS count')
          .from('operations_events', 'operations_events')
          .where('created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)')
          .getRawOne<{ count: string | number }>(),
        this.source
          .createQueryBuilder()
          .select('COUNT(*) AS count')
          .from('agent_tasks', 'agent_tasks')
          .where(
            'recovery_ready=TRUE AND cancel_requested=FALSE AND status IN (\'queued\',\'paused\')',
          )
          .getRawOne<{ count: string | number }>(),
        this.source
          .createQueryBuilder()
          .select('COUNT(*) AS count')
          .from('payment_orders', 'payment_orders')
          .where('status=\'pending\' AND expires_at<UTC_TIMESTAMP(3)')
          .getRawOne<{ count: string | number }>(),
      ])
    return {
      generatedAt: new Date().toISOString(),
      windowHours: 24,
      tasks: tasks.map((task) => ({
        status: task.status,
        count: Number(task.count),
      })),
      usage: {
        calls: Number(usage?.calls ?? 0),
        cost: decimal(BigInt(usage?.cost ?? 0)),
        charged: decimal(BigInt(usage?.charged ?? 0)),
        unresolved: Number((usage?.unresolved ?? 0) || 0),
      },
      resources: {
        files: Number(resources?.files ?? 0),
        bytes: String(resources?.bytes ?? 0),
      },
      errors: Number(errors?.count ?? 0),
      recoveryBacklog: Number(recovery?.count ?? 0),
      expiredPayments: Number(payments?.count ?? 0),
    }
  }

  async events(): Promise<OperationsEvent[]> {
    const rows = await this.source.getRepository(OperationsEventEntity).find({
      select: {
        id: true,
        kind: true,
        code: true,
        request_id: true,
        task_id: true,
        stage: true,
        agent_id: true,
        http_status: true,
        duration_ms: true,
        provider_request_id: true,
        created_at: true,
      },
      order: { created_at: 'DESC', id: 'DESC' },
      take: 100,
    })
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      code: row.code,
      requestId: row.request_id || undefined,
      taskId: row.task_id || undefined,
      stage: row.stage || undefined,
      agentId: row.agent_id || undefined,
      httpStatus: row.http_status || undefined,
      durationMs: row.duration_ms ?? undefined,
      providerRequestId: row.provider_request_id || undefined,
      createdAt: isoTime(row.created_at),
    }))
  }

  async task(id: string): Promise<OperationsTaskDetail> {
    const task = await this.source
      .createQueryBuilder()
      .select(
        't.id,t.user_id,t.conversation_id,t.request_id,t.status,t.agent_id,t.checkpoint_json,t.reason,t.created_at,t.updated_at,t.recovery_ready,t.recovery_attempts,u.username,u.nickname',
      )
      .from('agent_tasks', 't')
      .innerJoin('app_users', 'u', 'u.id=t.user_id')
      .where('t.id=:p0')
      .setParameters({ p0: id })
      .getRawOne<
        Pick<
          StoredAgentTask,
          | 'id' |
          'user_id' |
          'conversation_id' |
          'request_id' |
          'status' |
          'agent_id' |
          'checkpoint_json' |
          'reason' |
          'recovery_ready' |
          'recovery_attempts'
        > & {
          created_at: Date | string
          updated_at: Date | string
          username: string
          nickname: string
        }
    >()
    if (!task) {
      throw ErrorCode.TASK_NOT_FOUND()
    }
    const [tools, usage, modelCalls] = await Promise.all([
      this.source.getRepository(AgentTaskToolEntity).find({
        select: {
          call_id: true,
          name: true,
          agent_id: true,
          effect: true,
          status: true,
          updated_at: true,
        },
        where: { task_id: id },
        order: { updated_at: 'ASC', call_id: 'ASC' },
      }),
      this.source.getRepository(BillingUsageEntity).find({
        select: {
          id: true,
          model_config_id: true,
          purpose: true,
          status: true,
          fee_micro: true,
          charged_micro: true,
          input_tokens: true,
          output_tokens: true,
          duration_ms: true,
          created_at: true,
        },
        where: { task_id: id },
        order: { created_at: 'ASC', id: 'ASC' },
      }),
      new ModelOperations(this.source).forTask(id),
    ])
    const checkpoint = auditCheckpoint(task.checkpoint_json)
    const assistantId = checkpoint?.assistantId
    const messages = checkpoint.messages
    const index = messages.findIndex((m) => m.id === assistantId)
    const assistant =
      checkpoint?.auditResult ?? (index >= 0 ? messages[index] : null)
    const input =
      index >= 0
        ? messages.slice(0, index).findLast((m) => m.role === 'user')
        : null
    // Never serialize checkpoints: they also contain authentication and tool-resumption credentials.
    const publicMessage = (message: AuditMessage | null | undefined) =>
      message
        ? jsonValue(
            auditPayload({
              id: message.id,
              role: message.role,
              content: message.content,
              attachments: message.attachments?.map((r) => ({
                id: r.id,
                name: r.name,
                mimeType: r.mimeType,
              })),
            }),
          )
        : null
    return {
      id,
      user: {
        id: task.user_id,
        username: task.username,
        nickname: task.nickname,
      },
      modelCalls,
      input: publicMessage(input),
      output: publicMessage(assistant),
      error: assistant?.error ? jsonValue(auditPayload(assistant.error)) : null,
      retryCount: modelCalls.filter((call) => call.retryIndex > 0).length,
      userId: task.user_id,
      conversationId: task.conversation_id,
      requestId: task.request_id,
      status: task.status,
      agentId: task.agent_id,
      reason: task.reason || undefined,
      recoveryAttempts: Number(task.recovery_attempts),
      automaticRecovery: !!Number(task.recovery_ready),
      createdAt: isoTime(task.created_at),
      updatedAt: isoTime(task.updated_at),
      tools: tools.map((row) => ({
        callId: row.call_id,
        name: row.name,
        agentId: row.agent_id,
        effect: row.effect,
        status: row.status,
        updatedAt: isoTime(row.updated_at),
      })),
      usage: usage.map((row) => ({
        id: row.id,
        modelId: row.model_config_id,
        purpose: row.purpose,
        status: row.status,
        cost: decimal(BigInt(row.fee_micro)),
        charged: decimal(BigInt(row.charged_micro)),
        inputTokens:
          row.input_tokens === null ? null : Number(row.input_tokens),
        outputTokens:
          row.output_tokens === null ? null : Number(row.output_tokens),
        durationMs: row.duration_ms,
        createdAt: isoTime(row.created_at),
      })),
    }
  }
}
