import type { ConfigurationSnapshot } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import { ApiError } from '@t-box/server-foundation/errors'
import OpenAI from 'openai'
import { publicRunError } from '../chat/errors.js'
import { settingNumber } from '../configuration/defaults.js'

export interface RoutingCandidate {
  modelId: string
  id: string
  maxConcurrency: number
  providerConcurrency: number
}
/** Shared routing state and leases make selection fair across API/worker processes. */
export class ModelRouting {
  constructor(readonly source: DataSource) {}

  async select<T extends RoutingCandidate>(purpose: string, candidates: T[], configuration?: ConfigurationSnapshot, preferredModelId?: string): Promise<T> {
    if (!candidates.length) {
      throw new ApiError(503, 'MODEL_POOL_UNAVAILABLE', '模型池没有可用模型')
    }
    return this.source.transaction('READ COMMITTED', async (db) => {
      const [guard] = await db.query('SELECT sequence FROM ai_model_route_guard WHERE purpose=? FOR UPDATE', [purpose])
      if (!guard) {
        throw new ApiError(503, 'SCHEMA_REQUIRED', '请先初始化数据库')
      }
      const providers = [...new Set(candidates.map((item) => item.id))]
      const models = candidates.map((item) => item.modelId)
      const [active, health] = await Promise.all([
        db.query(`SELECT provider_id,model_id,COUNT(*) AS count FROM ai_provider_leases WHERE provider_id IN (${providers.map(() => '?').join(',')}) AND expires_at>=UTC_TIMESTAMP(3) GROUP BY provider_id,model_id`, providers),
        db.query(`SELECT model_id,last_selected,cooldown_until>UTC_TIMESTAMP(3) AS cooling FROM ai_model_routing WHERE model_id IN (${models.map(() => '?').join(',')})`, models),
      ])
      const modelLoad = new Map<string, number>()
      const providerLoad = new Map<string, number>()
      for (const row of active) {
        modelLoad.set(row.model_id, (modelLoad.get(row.model_id) || 0) + Number(row.count))
        providerLoad.set(row.provider_id, (providerLoad.get(row.provider_id) || 0) + Number(row.count))
      }
      const states = new Map<string, { last_selected: string, cooling: number }>(health.map((row: any) => [row.model_id, row]))
      const score = (item: T) => Math.max(
        (modelLoad.get(item.modelId) || 0) / item.maxConcurrency,
        (providerLoad.get(item.id) || 0) / (item.providerConcurrency || settingNumber(configuration, 'ai.provider.concurrency', 8)),
      )
      const available = candidates.filter((item) => !Number(states.get(item.modelId)?.cooling))
      available.sort((a, b) => score(a) - score(b) || Number(states.get(a.modelId)?.last_selected || 0) - Number(states.get(b.modelId)?.last_selected || 0) || a.modelId.localeCompare(b.modelId))
      const preferred = available.find((item) => item.modelId === preferredModelId && score(item) < 1)
      const chosen = preferred || available[0]
      if (!chosen) {
        throw new ApiError(503, 'MODEL_POOL_UNAVAILABLE', '模型服务暂时不可用，请稍后重试；已完成的操作仍保留')
      }
      const sequence = (BigInt(guard.sequence) + 1n).toString()
      await db.query('UPDATE ai_model_route_guard SET sequence=? WHERE purpose=?', [sequence, purpose])
      await db.query('INSERT INTO ai_model_routing(model_id,last_selected) VALUES(?,?) ON DUPLICATE KEY UPDATE last_selected=VALUES(last_selected)', [chosen.modelId, sequence])
      return chosen
    })
  }

  async success(modelId: string) {
    await this.source.query('UPDATE ai_model_routing SET failures=0,cooldown_until=NULL,last_error=NULL WHERE model_id=?', [modelId])
  }

  async failure(modelId: string, error: unknown, configuration?: ConfigurationSnapshot) {
    if (!(error instanceof OpenAI.APIError) && !(error instanceof ApiError && ['PROVIDER_STREAM_CLOSED', 'PROVIDER_INVALID_JSON', 'PROVIDER_INVALID_RESPONSE'].includes(error.code))) {
      return
    }
    const failure = publicRunError(error)
    const max = settingNumber(configuration, 'ai.routing.cooldownMaxMs', 60000)
    const base = Math.min(max, settingNumber(configuration, 'ai.routing.cooldownBaseMs', 5000))
    await this.source.query(`INSERT INTO ai_model_routing(model_id,failures,cooldown_until,last_error)
      VALUES(?,1,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MICROSECOND),?) ON DUPLICATE KEY UPDATE
      cooldown_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL LEAST(?,?*POW(2,LEAST(failures,8)))*1000 MICROSECOND),failures=failures+1,last_error=VALUES(last_error)`, [modelId, base * 1000, failure.code.slice(0, 80), max, base])
  }
}
