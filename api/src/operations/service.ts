import type {
  OperationsEvent,
  OperationsOverview,
  OperationsTaskDetail,
} from '@t-box/shared'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'
import { isoTime } from '@t-box/server-foundation/time'
import { decimal } from '../billing/money.js'

/** Operational metadata only. Never retain prompts, tool arguments, resource contents or secrets. */
export class OperationsService {
  constructor(readonly source: DataSource) {}
  async record(event: Omit<OperationsEvent, 'id' | 'createdAt'>) {
    await this.source.query(
      `INSERT INTO operations_events
      (id,kind,code,request_id,task_id,stage,agent_id,http_status,duration_ms,provider_request_id)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(),
        event.kind,
        event.code.slice(0, 80),
        event.requestId?.slice(0, 100) || null,
        event.taskId || null,
        event.stage?.slice(0, 32) || null,
        event.agentId?.slice(0, 100) || null,
        event.httpStatus || null,
        event.durationMs == null
          ? null
          : Math.max(0, Math.min(2147483647, Math.round(event.durationMs))),
        event.providerRequestId?.slice(0, 256) || null,
      ],
    )
  }

  async overview(): Promise<OperationsOverview> {
    const [tasks, [usage], [resources], [errors], [recovery], [payments]] =
      await Promise.all([
        this.source.query(
          `SELECT status,COUNT(*) AS count FROM agent_tasks WHERE updated_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY) GROUP BY status`,
        ),
        this.source
          .query(`SELECT COUNT(*) AS calls,COALESCE(SUM(fee_micro),0) AS cost,COALESCE(SUM(charged_micro),0) AS charged,
        SUM(status IN ('reserved','review')) AS unresolved FROM billing_usage WHERE created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)`),
        this.source.query(
          'SELECT COUNT(*) AS files,COALESCE(SUM(size),0) AS bytes FROM resources WHERE deleted_at IS NULL',
        ),
        this.source.query(
          `SELECT COUNT(*) AS count FROM operations_events WHERE created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)`,
        ),
        this.source.query(
          `SELECT COUNT(*) AS count FROM agent_tasks WHERE recovery_ready=TRUE AND cancel_requested=FALSE AND status IN ('queued','paused')`,
        ),
        this.source.query(
          `SELECT COUNT(*) AS count FROM payment_orders WHERE status='pending' AND expires_at<UTC_TIMESTAMP(3)`,
        ),
      ])
    return {
      generatedAt: new Date().toISOString(),
      windowHours: 24,
      tasks: tasks.map((task: any) => ({
        status: task.status,
        count: Number(task.count),
      })),
      usage: {
        calls: Number(usage.calls),
        cost: decimal(BigInt(usage.cost)),
        charged: decimal(BigInt(usage.charged)),
        unresolved: Number(usage.unresolved || 0),
      },
      resources: {
        files: Number(resources.files),
        bytes: String(resources.bytes),
      },
      errors: Number(errors.count),
      recoveryBacklog: Number(recovery.count),
      expiredPayments: Number(payments.count),
    }
  }

  async events(): Promise<OperationsEvent[]> {
    const rows = await this.source.query(
      'SELECT * FROM operations_events ORDER BY created_at DESC,id DESC LIMIT 100',
    )
    return rows.map((row: any) => ({
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
    const [task] = await this.source.query(
      'SELECT id,user_id,conversation_id,request_id,status,agent_id,reason,recovery_attempts,recovery_ready,created_at,updated_at FROM agent_tasks WHERE id=?',
      [id],
    )
    if (!task) {
      throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在')
    }
    const [tools, usage] = await Promise.all([
      this.source.query(
        'SELECT call_id,name,agent_id,effect,status,updated_at FROM agent_task_tools WHERE task_id=? ORDER BY updated_at,call_id',
        [id],
      ),
      this.source.query(
        'SELECT id,model_config_id,purpose,status,fee_micro,charged_micro,input_tokens,output_tokens,duration_ms,created_at FROM billing_usage WHERE task_id=? ORDER BY created_at,id',
        [id],
      ),
    ])
    return {
      id,
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
      tools: tools.map((row: any) => ({
        callId: row.call_id,
        name: row.name,
        agentId: row.agent_id,
        effect: row.effect,
        status: row.status,
        updatedAt: isoTime(row.updated_at),
      })),
      usage: usage.map((row: any) => ({
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
