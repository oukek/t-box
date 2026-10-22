import type { ConfigurationSnapshot } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import { ApiError } from '@t-box/server-foundation/errors'
import OpenAI from 'openai'
import { publicRunError } from '../chat/errors.js'
import { settingNumber } from '../configuration/defaults.js'
import {
  AiModelRouteGuardEntity,
  AiModelRoutingEntity,
} from '../db/records/models-entities.js'
import { ErrorCode } from '../error-codes.js'

export interface RoutingCandidate {
  modelId: string
  id: string
  maxConcurrency: number
  providerConcurrency: number
}
/** Shared routing state and leases make selection fair across API/worker processes. */
export class ModelRouting {
  constructor(readonly source: DataSource) {}

  async select<T extends RoutingCandidate>(
    purpose: string,
    candidates: T[],
    configuration?: ConfigurationSnapshot,
    preferredModelId?: string,
  ): Promise<T> {
    if (!candidates.length) {
      throw ErrorCode.MODEL_POOL_UNAVAILABLE()
    }
    return this.source.transaction('READ COMMITTED', async (db) => {
      const guard = await db.getRepository(AiModelRouteGuardEntity).findOne({
        select: { sequence: true },
        where: { purpose },
        lock: { mode: 'pessimistic_write' },
      })
      if (!guard) {
        throw ErrorCode.SCHEMA_REQUIRED()
      }
      const providers = [...new Set(candidates.map((item) => item.id))]
      const models = candidates.map((item) => item.modelId)
      const [active, health] = await Promise.all([
        db
          .createQueryBuilder()
          .select('provider_id')
          .addSelect('model_id')
          .addSelect('COUNT(*)', 'count')
          .from('ai_provider_leases', 'leases')
          .where(
            'provider_id IN (:...providers) AND expires_at>=UTC_TIMESTAMP(3)',
            { providers },
          )
          .groupBy('provider_id')
          .addGroupBy('model_id')
          .getRawMany<{
          provider_id: string
          model_id: string | null
          count: string | number
        }>(),
        db
          .createQueryBuilder()
          .select(
            'model_id,last_selected,cooldown_until>UTC_TIMESTAMP(3) AS cooling',
          )
          .from('ai_model_routing', 'ai_model_routing')
          .where('model_id IN (:...p0)')
          .setParameters({ p0: models })
          .getRawMany<{
          model_id: string
          last_selected: string | number
          cooling: number | null
        }>(),
      ])
      const modelLoad = new Map<string, number>()
      const providerLoad = new Map<string, number>()
      for (const row of active) {
        if (row.model_id !== null) {
          modelLoad.set(
            row.model_id,
            (modelLoad.get(row.model_id) || 0) + Number(row.count),
          )
        }
        providerLoad.set(
          row.provider_id,
          (providerLoad.get(row.provider_id) || 0) + Number(row.count),
        )
      }
      const states = new Map<
        string,
        { last_selected: string | number, cooling: number | null }
      >(health.map((row) => [row.model_id, row]))
      const score = (item: T) =>
        Math.max(
          (modelLoad.get(item.modelId) || 0) / item.maxConcurrency,
          (providerLoad.get(item.id) || 0) /
          (item.providerConcurrency ||
            settingNumber(configuration, 'ai.provider.concurrency', 8)),
        )
      const available = candidates.filter(
        (item) => !Number(states.get(item.modelId)?.cooling),
      )
      available.sort(
        (a, b) =>
          score(a) - score(b) ||
          Number(states.get(a.modelId)?.last_selected || 0) -
          Number(states.get(b.modelId)?.last_selected || 0) ||
          a.modelId.localeCompare(b.modelId),
      )
      const preferred = available.find(
        (item) => item.modelId === preferredModelId && score(item) < 1,
      )
      const chosen = preferred || available[0]
      if (!chosen) {
        throw ErrorCode.MODEL_POOL_UNAVAILABLE(
          '模型服务暂时不可用，请稍后重试；已完成的操作仍保留',
        )
      }
      const sequence = (BigInt(guard.sequence) + 1n).toString()
      await db
        .getRepository(AiModelRouteGuardEntity)
        .update({ purpose }, { sequence })
      await db
        .createQueryBuilder()
        .insert()
        .into('ai_model_routing')
        .values({ model_id: () => ':p0', last_selected: () => ':p1' })
        .updateEntity(false)
        .setParameters({ p0: chosen.modelId, p1: sequence })
        .orUpdate(['last_selected'])
        .execute()
      return chosen
    })
  }

  async success(modelId: string) {
    await this.source
      .getRepository(AiModelRoutingEntity)
      .update(
        { model_id: modelId },
        { failures: 0, cooldown_until: null, last_error: null },
      )
  }

  async failure(
    modelId: string,
    error: unknown,
    configuration?: ConfigurationSnapshot,
  ) {
    if (
      !(error instanceof OpenAI.APIError) &&
      !(
        error instanceof ApiError &&
        [
          'PROVIDER_STREAM_CLOSED',
          'PROVIDER_FAILED',
          'PROVIDER_INVALID_JSON',
          'PROVIDER_INVALID_RESPONSE',
        ].includes(error.code)
      )
    ) {
      return
    }
    const failure = publicRunError(error)
    const max = settingNumber(configuration, 'ai.routing.cooldownMaxMs', 60000)
    const base = Math.min(
      max,
      settingNumber(configuration, 'ai.routing.cooldownBaseMs', 5000),
    )
    // native-sql: atomic counter, cooldown or permission merge; preserve existing-row expressions
    await this.source.query(
      `INSERT INTO ai_model_routing(model_id,failures,cooldown_until,last_error)
      VALUES(?,1,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MICROSECOND),?) ON DUPLICATE KEY UPDATE
      cooldown_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL LEAST(?,?*POW(2,LEAST(failures,8)))*1000 MICROSECOND),failures=failures+1,last_error=VALUES(last_error)`,
      [modelId, base * 1000, failure.code.slice(0, 80), max, base],
    )
  }
}
