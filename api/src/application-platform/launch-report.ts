import { validId } from '@t-box/app-contracts'
import { ErrorCode } from '../error-codes.js'

/** Client diagnostics are untrusted and explicitly exclude input, SDK credentials and file URLs. */
export function parseLaunchReport(input: unknown, appId: string) {
  const value = input as Record<string, unknown> | null
  if (!value || Array.isArray(value) || Object.keys(value).some((key) => !['id', 'appId', 'releaseId', 'source', 'platform', 'outcome', 'totalMs', 'stages', 'errorCode', 'createdAt'].includes(key)) || value.appId !== appId || !validId(appId) || typeof value.id !== 'string' || !/^[\w-]{1,80}$/.test(value.id) || typeof value.releaseId !== 'string' || value.releaseId.length > 100 || !['local', 'network', 'development'].includes(String(value.source)) || !['web', 'ios', 'android'].includes(String(value.platform)) || !['ready', 'failed', 'cancelled', 'rolled_back'].includes(String(value.outcome)) || typeof value.totalMs !== 'number' || !Number.isSafeInteger(value.totalMs) || value.totalMs < 0 || value.totalMs > 900_000 || !value.stages || typeof value.stages !== 'object' || Array.isArray(value.stages)) {
    throw ErrorCode.BAD_REQUEST('启动耗时记录无效')
  }
  const stages: Record<string, number> = {}
  for (const [key, duration] of Object.entries(value.stages)) {
    if (!['resolving', 'preparing', 'resources', 'loading', 'connecting', 'rollback'].includes(key) || typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration < 0 || duration > 900_000) {
      throw ErrorCode.BAD_REQUEST('启动阶段耗时无效')
    }
    stages[key] = duration
  }
  if (value.errorCode !== undefined && (typeof value.errorCode !== 'string' || !/^[A-Z0-9_]{1,100}$/.test(value.errorCode))) {
    throw ErrorCode.BAD_REQUEST('启动错误标识无效')
  }
  return { id: value.id, appId, releaseId: value.releaseId, source: String(value.source), platform: String(value.platform), outcome: String(value.outcome), totalMs: value.totalMs, stages, errorCode: value.errorCode }
}
