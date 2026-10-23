import type {
  OperationsModelCall,
  OperationsModelCallDetail,
  OperationsPage,
  OperationsTaskRow,
} from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { StoredAiModelCall } from '../db/records/models-entities.js'
import type { StoredAgentTask } from '../db/records/tasks-entities.js'
import { isoTime } from '@t-box/server-foundation/time'
import { decimal } from '../billing/money.js'
import { QuotaInventory } from '../billing/quota/inventory.js'
import { quotaText } from '../billing/quota/math.js'
import { ErrorCode } from '../error-codes.js'
import { ModelCallAudit } from '../models/audit.js'
import { jsonValue, operationFilters } from './queries.js'

type SqlNumber = string | number
interface ModelSnapshot {
  model_id: string
  model_name: string
  remote_model: string
  provider_id: string
  provider_name: string
}
interface UserSnapshot {
  user_id: string
  username: string
  nickname: string
}
type CallRow = Pick<
  StoredAiModelCall,
  | 'id' |
  'logical_id' |
  'retry_index' |
  'task_id' |
  'message_id' |
  'purpose' |
  'method' |
  'invocation_mode' |
  'status' |
  'user_error' |
  'input_tokens' |
  'output_tokens' |
  'cached_tokens' |
  'reasoning_tokens' |
  'images' |
  'duration_ms' |
  'queue_ms'
> &
ModelSnapshot &
UserSnapshot & {
  billing_status: string | null
  fee_micro: string | null
  quota_charged: string | null
  cache_write_tokens: SqlNumber | null
  created_at: Date | string
  started_at: Date | string | null
  finished_at: Date | string | null
}
type CallDetailRow = CallRow &
  Pick<
    StoredAiModelCall,
    | 'input_json' |
    'output_json' |
    'diagnostics_json' |
    'provider_request_id' |
    'response_id'
  > & {
    prices_json: unknown
    upstream_original_micro: string | null
    quota_due: string | null
    mode: import('@t-box/shared').BillingMode | null
    tariff_json: unknown
  }
type TaskRow = Pick<
  StoredAgentTask,
  | 'id' |
  'conversation_id' |
  'request_id' |
  'status' |
  'agent_id' |
  'reason' |
  'recovery_attempts'
> &
UserSnapshot & { created_at: Date | string, updated_at: Date | string }
interface TaskCharges {
  task_id: string
  calls: SqlNumber
  legacy_calls: SqlNumber
  cost: string | null
  charged: string | null
  unresolved: SqlNumber | null
  input_tokens: SqlNumber | null
  output_tokens: SqlNumber | null
}
interface TaskCalls {
  task_id: string
  calls: SqlNumber
  retries: SqlNumber | null
  failures: SqlNumber | null
}
const amount = (value: unknown) => decimal(BigInt(String(value || 0)))
const nullableNumber = (value: unknown) =>
  value == null ? null : Number(value)
const model = (row: ModelSnapshot) => ({
  id: row.model_id,
  name: row.model_name,
  remoteModel: row.remote_model,
  providerId: row.provider_id,
  providerName: row.provider_name,
})
const user = (row: UserSnapshot) => ({
  id: row.user_id,
  username: row.username,
  nickname: row.nickname,
})
function callView(row: CallRow): OperationsModelCall {
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
    charged:
      row.quota_charged == null ? null : quotaText(BigInt(row.quota_charged)),
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
  b.status AS billing_status,b.fee_micro,b.quota_charged,b.cache_write_tokens`
/** Immutable model/provider snapshots survive configuration edits and removal. Large payloads are detail-only. */
export class ModelOperations {
  constructor(readonly source: DataSource) {}

  private callSelection() {
    return this.source
      .createQueryBuilder()
      .select(summaryColumns)
      .from('ai_model_calls', 'c')
      .innerJoin('app_users', 'u', 'u.id=c.user_id')
      .leftJoin('billing_usage', 'b', 'b.id=c.id')
  }

  async calls(query: unknown): Promise<OperationsPage<OperationsModelCall>> {
    await new ModelCallAudit(this.source).recover()
    const filter = operationFilters(query, 'call')
    const selection = this.callSelection().where(
      filter.condition,
      filter.bindings,
    )
    const [count, rows] = await Promise.all([
      selection
        .clone()
        .select('COUNT(*)', 'total')
        .getRawOne<{ total: string | number }>(),
      selection
        .orderBy('c.created_at', 'DESC')
        .addOrderBy('c.id', 'DESC')
        .limit(filter.pageSize)
        .offset(filter.offset)
        .getRawMany<CallRow>(),
    ])
    return {
      items: rows.map(callView),
      total: Number(count?.total ?? 0),
      page: filter.page,
      pageSize: filter.pageSize,
    }
  }

  async call(id: string): Promise<OperationsModelCallDetail> {
    const row = await this.callSelection()
      .addSelect(
        'c.input_json,c.output_json,c.diagnostics_json,c.provider_request_id,c.response_id,b.prices_json,b.upstream_original_micro,b.quota_due,b.mode,b.tariff_json',
      )
      .where('c.id=:id', { id })
      .getRawOne<CallDetailRow>()
    if (!row) {
      throw ErrorCode.MODEL_CALL_NOT_FOUND()
    }
    return {
      ...callView(row),
      input: jsonValue(row.input_json),
      output: jsonValue(row.output_json),
      diagnostics: jsonValue(row.diagnostics_json),
      providerRequestId: row.provider_request_id,
      responseId: row.response_id,
      prices: jsonValue(row.prices_json),
      originalCost:
        row.upstream_original_micro == null
          ? null
          : amount(row.upstream_original_micro),
      expectedQuota:
        row.quota_due == null ? null : quotaText(BigInt(row.quota_due)),
      billingMode: row.mode,
      tariff: jsonValue(row.tariff_json),
      allocations: await new QuotaInventory().allocations(
        this.source.manager,
        row.user_id,
        row.id,
      ),
    }
  }

  async forTask(id: string): Promise<OperationsModelCall[]> {
    const rows = await this.callSelection()
      .where('c.task_id=:id', { id })
      .orderBy('c.created_at', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .limit(1000)
      .getRawMany<CallRow>()
    return rows.map(callView)
  }

  async tasks(query: unknown): Promise<OperationsPage<OperationsTaskRow>> {
    await new ModelCallAudit(this.source).recover()
    const filter = operationFilters(query, 'task')
    const selection = this.source
      .createQueryBuilder()
      .from('agent_tasks', 't')
      .innerJoin('app_users', 'u', 'u.id=t.user_id')
      .where(filter.condition, filter.bindings)
    const [count, rows] = await Promise.all([
      selection
        .clone()
        .select('COUNT(*)', 'total')
        .getRawOne<{ total: string | number }>(),
      selection
        .select(
          't.id,t.user_id,u.username,u.nickname,t.conversation_id,t.request_id,t.status,t.agent_id,t.reason,t.recovery_attempts,t.created_at,t.updated_at',
        )
        .orderBy('t.created_at', 'DESC')
        .addOrderBy('t.id', 'DESC')
        .limit(filter.pageSize)
        .offset(filter.offset)
        .getRawMany<TaskRow>(),
    ])
    const ids = rows.map((row) => row.id)
    if (!ids.length) {
      return {
        items: [],
        total: Number(count?.total ?? 0),
        page: filter.page,
        pageSize: filter.pageSize,
      }
    }
    const placeholders = ids.map(() => '?').join(',')
    // Pre-aggregate each source independently: joining tool/call/usage rows would multiply fees.
    const [charges, calls, models] = await Promise.all([
      // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
      this.source.query<TaskCharges[]>(
        `SELECT b.task_id,COUNT(*) AS calls,SUM(c.id IS NULL) AS legacy_calls,SUM(b.fee_micro) AS cost,SUM(b.quota_charged) AS charged,SUM(b.status IN ('reserved','review')) AS unresolved,
        SUM(b.input_tokens) AS input_tokens,SUM(b.output_tokens) AS output_tokens FROM billing_usage b LEFT JOIN ai_model_calls c ON c.id=b.id WHERE b.task_id IN (${placeholders}) GROUP BY b.task_id`,
        ids,
      ),
      this.source
        .createQueryBuilder()
        .select('task_id')
        .addSelect('COUNT(*)', 'calls')
        .addSelect('SUM(retry_index>0)', 'retries')
        .addSelect('SUM(status IN (\'failed\',\'interrupted\'))', 'failures')
        .from('ai_model_calls', 'calls')
        .where('task_id IN (:...ids)', { ids })
        .groupBy('task_id')
        .getRawMany<TaskCalls>(),
      // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
      this.source.query<(ModelSnapshot & { task_id: string })[]>(
        `SELECT DISTINCT task_id,model_id,model_name,remote_model,provider_id,provider_name FROM ai_model_calls WHERE task_id IN (${placeholders})
        UNION SELECT DISTINCT b.task_id,m.id AS model_id,m.name AS model_name,m.model_id AS remote_model,p.id AS provider_id,p.name AS provider_name
        FROM billing_usage b JOIN ai_models m ON m.id=b.model_config_id JOIN ai_providers p ON p.id=m.provider_id
        WHERE b.task_id IN (${placeholders}) AND NOT EXISTS(SELECT 1 FROM ai_model_calls c WHERE c.id=b.id)`,
        [...ids, ...ids],
      ),
    ])
    return {
      items: rows.map((row) => {
        const billed = charges.find((value) => value.task_id === row.id)
        const invoked = calls.find((value) => value.task_id === row.id)
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
          calls:
            Number(invoked?.calls || 0) + Number(billed?.legacy_calls || 0),
          failedCalls: Number(invoked?.failures || 0),
          models: models.filter((value) => value.task_id === row.id).map(model),
          cost: amount(billed?.cost),
          charged: quotaText(BigInt(billed?.charged ?? 0)),
          unresolved: Number(billed?.unresolved || 0),
          inputTokens: Number(billed?.input_tokens || 0),
          outputTokens: Number(billed?.output_tokens || 0),
          createdAt: isoTime(row.created_at),
          updatedAt: isoTime(row.updated_at),
        }
      }),
      total: Number(count?.total ?? 0),
      page: filter.page,
      pageSize: filter.pageSize,
    }
  }
}
