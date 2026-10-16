import type { OperationsModelCall, OperationsModelCallDetail, OperationsPage, OperationsTaskRow } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import { ApiError } from '@t-box/server-foundation/errors'
import { isoTime } from '@t-box/server-foundation/time'
import { decimal } from '../billing/money.js'
import { ModelCallAudit } from '../models/audit.js'
import { jsonValue, operationFilters } from './queries.js'

const amount = (value: unknown) => decimal(BigInt(String(value || 0)))
const nullableNumber = (value: unknown) => value == null ? null : Number(value)
const model = (row: any) => ({ id: row.model_id, name: row.model_name, remoteModel: row.remote_model, providerId: row.provider_id, providerName: row.provider_name })
const user = (row: any) => ({ id: row.user_id, username: row.username, nickname: row.nickname })
function callView(row: any): OperationsModelCall {
  return {
    ...model(row),
    user: user(row),
    callId: row.id,
    logicalId: row.logical_id,
    retryIndex: Number(row.retry_index),
    taskId: row.task_id,
    messageId: row.message_id,
    purpose: row.purpose,
    method: row.method,
    invocationMode: row.invocation_mode,
    status: row.status,
    billingStatus: row.billing_status,
    cost: row.fee_micro == null ? null : amount(row.fee_micro),
    charged: row.charged_micro == null ? null : amount(row.charged_micro),
    inputTokens: nullableNumber(row.input_tokens),
    outputTokens: nullableNumber(row.output_tokens),
    cachedInputTokens: nullableNumber(row.cached_tokens),
    cacheWriteTokens: nullableNumber(row.cache_write_tokens),
    reasoningTokens: nullableNumber(row.reasoning_tokens),
    images: nullableNumber(row.images),
    durationMs: nullableNumber(row.duration_ms),
    queueMs: nullableNumber(row.queue_ms),
    userError: row.user_error,
    createdAt: isoTime(row.created_at),
    startedAt: row.started_at ? isoTime(row.started_at) : null,
    finishedAt: row.finished_at ? isoTime(row.finished_at) : null,
  }
}
const summaryColumns = `c.id,c.logical_id,c.retry_index,c.task_id,c.message_id,c.user_id,u.username,u.nickname,
  c.provider_id,c.provider_name,c.model_id,c.model_name,c.remote_model,c.invocation_mode,c.purpose,c.method,c.status,
  c.user_error,c.input_tokens,c.output_tokens,c.cached_tokens,c.reasoning_tokens,c.images,c.duration_ms,c.queue_ms,c.created_at,c.started_at,c.finished_at,
  b.status AS billing_status,b.fee_micro,b.charged_micro,b.cache_write_tokens`
const callJoins = 'FROM ai_model_calls c JOIN app_users u ON u.id=c.user_id LEFT JOIN billing_usage b ON b.id=c.id'
/** Immutable model/provider snapshots survive configuration edits and removal. Large payloads are detail-only. */
export class ModelOperations {
  constructor(readonly source: DataSource) {}

  async calls(query: unknown): Promise<OperationsPage<OperationsModelCall>> {
    await new ModelCallAudit(this.source).recover()
    const filter = operationFilters(query, 'call')
    const [[count], rows] = await Promise.all([
      this.source.query(`SELECT COUNT(*) AS total ${callJoins} ${filter.where}`, filter.parameters),
      this.source.query(`SELECT ${summaryColumns} ${callJoins} ${filter.where} ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`, [...filter.parameters, filter.pageSize, filter.offset]),
    ])
    return { items: rows.map(callView), total: Number(count.total), page: filter.page, pageSize: filter.pageSize }
  }

  async call(id: string): Promise<OperationsModelCallDetail> {
    const [row] = await this.source.query(`SELECT ${summaryColumns},c.input_json,c.output_json,c.diagnostics_json,c.provider_request_id,c.response_id,b.prices_json ${callJoins} WHERE c.id=?`, [id])
    if (!row) {
      throw new ApiError(404, 'MODEL_CALL_NOT_FOUND', '模型调用记录不存在')
    }
    return { ...callView(row), input: jsonValue(row.input_json), output: jsonValue(row.output_json), diagnostics: jsonValue(row.diagnostics_json), providerRequestId: row.provider_request_id, responseId: row.response_id, prices: jsonValue(row.prices_json) }
  }

  async forTask(id: string): Promise<OperationsModelCall[]> {
    const rows = await this.source.query(`SELECT ${summaryColumns} ${callJoins} WHERE c.task_id=? ORDER BY c.created_at,c.id LIMIT 1000`, [id])
    return rows.map(callView)
  }

  async tasks(query: unknown): Promise<OperationsPage<OperationsTaskRow>> {
    await new ModelCallAudit(this.source).recover()
    const filter = operationFilters(query, 'task')
    const joins = 'FROM agent_tasks t JOIN app_users u ON u.id=t.user_id'
    const [[count], rows] = await Promise.all([
      this.source.query(`SELECT COUNT(*) AS total ${joins} ${filter.where}`, filter.parameters),
      this.source.query(`SELECT t.id,t.user_id,u.username,u.nickname,t.conversation_id,t.request_id,t.status,t.agent_id,t.reason,t.recovery_attempts,t.created_at,t.updated_at
        ${joins} ${filter.where} ORDER BY t.created_at DESC,t.id DESC LIMIT ? OFFSET ?`, [...filter.parameters, filter.pageSize, filter.offset]),
    ])
    const ids = rows.map((row: any) => row.id)
    if (!ids.length) {
      return { items: [], total: Number(count.total), page: filter.page, pageSize: filter.pageSize }
    }
    const placeholders = ids.map(() => '?').join(',')
    // Pre-aggregate each source independently: joining tool/call/usage rows would multiply fees.
    const [charges, calls, models] = await Promise.all([
      this.source.query(`SELECT b.task_id,COUNT(*) AS calls,SUM(c.id IS NULL) AS legacy_calls,SUM(b.fee_micro) AS cost,SUM(b.charged_micro) AS charged,SUM(b.status IN ('reserved','review')) AS unresolved,
        SUM(b.input_tokens) AS input_tokens,SUM(b.output_tokens) AS output_tokens FROM billing_usage b LEFT JOIN ai_model_calls c ON c.id=b.id WHERE b.task_id IN (${placeholders}) GROUP BY b.task_id`, ids),
      this.source.query(`SELECT task_id,COUNT(*) AS calls,SUM(retry_index>0) AS retries,SUM(status IN ('failed','interrupted')) AS failures FROM ai_model_calls WHERE task_id IN (${placeholders}) GROUP BY task_id`, ids),
      this.source.query(`SELECT DISTINCT task_id,model_id,model_name,remote_model,provider_id,provider_name FROM ai_model_calls WHERE task_id IN (${placeholders})
        UNION SELECT DISTINCT b.task_id,m.id AS model_id,m.name AS model_name,m.model_id AS remote_model,p.id AS provider_id,p.name AS provider_name
        FROM billing_usage b JOIN ai_models m ON m.id=b.model_config_id JOIN ai_providers p ON p.id=m.provider_id
        WHERE b.task_id IN (${placeholders}) AND NOT EXISTS(SELECT 1 FROM ai_model_calls c WHERE c.id=b.id)`, [...ids, ...ids]),
    ])
    return {
      items: rows.map((row: any) => {
        const billed = charges.find((value: any) => value.task_id === row.id)
        const invoked = calls.find((value: any) => value.task_id === row.id)
        return {
          id: row.id,
          user: user(row),
          conversationId: row.conversation_id,
          requestId: row.request_id,
          status: row.status,
          agentId: row.agent_id,
          reason: row.reason,
          recoveryAttempts: Number(row.recovery_attempts),
          retryCount: Number(invoked?.retries || 0),
          calls: Number(invoked?.calls || 0) + Number(billed?.legacy_calls || 0),
          failedCalls: Number(invoked?.failures || 0),
          models: models.filter((value: any) => value.task_id === row.id).map(model),
          cost: amount(billed?.cost),
          charged: amount(billed?.charged),
          unresolved: Number(billed?.unresolved || 0),
          inputTokens: Number(billed?.input_tokens || 0),
          outputTokens: Number(billed?.output_tokens || 0),
          createdAt: isoTime(row.created_at),
          updatedAt: isoTime(row.updated_at),
        }
      }),
      total: Number(count.total),
      page: filter.page,
      pageSize: filter.pageSize,
    }
  }
}
