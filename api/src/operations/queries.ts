import { ApiError } from '@t-box/server-foundation/errors'
import { parseId } from '@t-box/server-foundation/validation'

export interface OperationsQuery {
  page?: unknown
  pageSize?: unknown
  search?: unknown
  status?: unknown
  userId?: unknown
  taskId?: unknown
  modelId?: unknown
  providerId?: unknown
}
export function operationFilters(value: unknown, kind: 'task' | 'call') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_QUERY', '查询参数无效')
  }
  const query = value as OperationsQuery
  const integer = (value: unknown, fallback: number, max: number) => {
    if (value === undefined) {
      return fallback
    }
    if (typeof value !== 'string' || !/^\d{1,6}$/.test(value) || Number(value) < 1 || Number(value) > max) {
      throw new ApiError(400, 'INVALID_QUERY', '分页参数无效')
    }
    return Number(value)
  }
  const page = integer(query.page, 1, 10000)
  const pageSize = integer(query.pageSize, 20, 50)
  const conditions: string[] = []
  const parameters: unknown[] = []
  const alias = kind === 'task' ? 't' : 'c'
  if (query.status) {
    const statuses = kind === 'task' ? ['queued', 'running', 'waiting_client', 'paused', 'needs_review', 'completed', 'cancelled'] : ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']
    if (!statuses.includes(String(query.status))) {
      throw new ApiError(400, 'INVALID_QUERY', '任务或调用状态无效')
    }
    conditions.push(`${alias}.status=?`)
    parameters.push(query.status)
  }
  for (const [key, column] of [['userId', 'user_id'], ['taskId', kind === 'task' ? 'id' : 'task_id']] as const) {
    if (query[key]) {
      conditions.push(`${alias}.${column}=?`)
      parameters.push(parseId(query[key]))
    }
  }
  const selected: string[] = []
  const selectedValues: string[] = []
  for (const [key, column] of [['modelId', 'model_id'], ['providerId', 'provider_id']] as const) {
    if (query[key]) {
      selected.push(`${kind === 'task' ? 'mc' : 'c'}.${column}=?`)
      selectedValues.push(parseId(query[key]))
    }
  }
  if (selected.length) {
    if (kind === 'task') {
      const legacy = selected.map((sql) => sql.replace('mc.model_id', 'm.id').replace('mc.provider_id', 'p.id')).join(' AND ')
      conditions.push(`(EXISTS(SELECT 1 FROM ai_model_calls mc WHERE mc.task_id=t.id AND ${selected.join(' AND ')}) OR
        EXISTS(SELECT 1 FROM billing_usage b JOIN ai_models m ON m.id=b.model_config_id JOIN ai_providers p ON p.id=m.provider_id
          WHERE b.task_id=t.id AND ${legacy} AND NOT EXISTS(SELECT 1 FROM ai_model_calls history WHERE history.id=b.id)))`)
      parameters.push(...selectedValues, ...selectedValues)
    } else {
      conditions.push(selected.join(' AND '))
      parameters.push(...selectedValues)
    }
  }
  if (query.search !== undefined && query.search !== '') {
    if (typeof query.search !== 'string' || query.search.length > 100) {
      throw new ApiError(400, 'INVALID_QUERY', '搜索内容最多 100 个字符')
    }
    // Literal search; wildcard characters have no special meaning.
    const search = `%${query.search.trim().replace(/[!%_]/g, '!$&')}%`
    conditions.push(`(${alias}.id LIKE ? ESCAPE '!' OR u.username LIKE ? ESCAPE '!' OR u.nickname LIKE ? ESCAPE '!')`)
    parameters.push(search, search, search)
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', parameters, page, pageSize, offset: (page - 1) * pageSize }
}
export function jsonValue(value: unknown): any {
  if (typeof value !== 'string') {
    return value ?? null
  }
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
