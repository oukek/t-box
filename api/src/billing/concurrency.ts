import type { ConfigurationSnapshot } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Raw } from 'typeorm'
import { settingNumber } from '../configuration/defaults.js'
import { ModelEntity, ProviderEntity } from '../db/entities.js'
import {
  AiModelRoutingEntity,
  AiProviderLeaseEntity,
  AiProviderPoolEntity,
} from '../db/records/models-entities.js'
import { ErrorCode } from '../error-codes.js'

/** Cross-process provider slots. A slot is held until the actual request settles, including abort cleanup. */
export class ProviderConcurrency {
  constructor(readonly source: DataSource) {}

  /** Retry only database lease mutations, never the provider callback or billing. */
  private async leaseMutation<T>(
    work: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await work()
      } catch (error) {
        const code = (error as { code?: string } | undefined)?.code
        if (
          attempt >= 2 ||
          !['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code || '')
        ) {
          throw error
        }
        await delay(25 * (attempt + 1), undefined, { signal })
      }
    }
  }

  private async cleanupExpired(providerId: string) {
    const rows: { id: string }[] = await this.source
      .getRepository(AiProviderLeaseEntity)
      .find({
        select: { id: true },
        where: {
          provider_id: providerId,
          expires_at: Raw((column) => `${column} < UTC_TIMESTAMP(3)`),
        },
        take: 128,
      })
    // Match release/renewal's primary-key lock order; a secondary-index range DELETE
    // can deadlock a request finishing through the primary key.
    for (const { id } of rows) {
      await this.leaseMutation(() =>
        this.source.getRepository(AiProviderLeaseEntity).delete({
          id,
          expires_at: Raw((column) => `${column} < UTC_TIMESTAMP(3)`),
        }),
      )
    }
  }

  async run<T>(
    providerId: string,
    signal: AbortSignal,
    configuration: ConfigurationSnapshot | undefined,
    invoke: (signal: AbortSignal) => Promise<T>,
    model?: {
      id: string
      maxConcurrency: number
      providerConcurrency?: number
    },
  ): Promise<T> {
    const defaultLimit =
      model?.providerConcurrency ||
      settingNumber(configuration, 'ai.provider.concurrency', 8)
    const deadline =
      Date.now() +
      settingNumber(configuration, 'ai.provider.queueTimeoutMs', 30000)
    const id = randomUUID()
    await this.cleanupExpired(providerId)
    while (true) {
      signal.throwIfAborted()
      const acquired = await this.leaseMutation(
        () =>
          this.source.transaction('READ COMMITTED', async (db) => {
            await db
              .createQueryBuilder()
              .insert()
              .into('ai_provider_pools')
              .values({ provider_id: () => ':p0' })
              .updateEntity(false)
              .setParameters({ p0: providerId })
              .orUpdate(['provider_id'])
              .execute()
            await db.getRepository(AiProviderPoolEntity).find({
              select: { provider_id: true },
              where: { provider_id: providerId },
              lock: { mode: 'pessimistic_write' },
            })
            const activeProviderLeases = await db
              .getRepository(AiProviderLeaseEntity)
              .countBy({
                provider_id: providerId,
                expires_at: Raw((column) => `${column} >= UTC_TIMESTAMP(3)`),
              })
            const provider = await db
              .getRepository(ProviderEntity)
              .findOne({
                select: { maxConcurrency: true },
                where: { id: providerId },
              })
              .then((row) =>
                row ? { max_concurrency: row.maxConcurrency } : null,
              )
            const limit = Number(provider?.max_concurrency) || defaultLimit
            if (activeProviderLeases >= limit) {
              return false
            }
            if (model) {
              await db
                .createQueryBuilder()
                .insert()
                .into('ai_model_routing')
                .values({ model_id: model.id })
                .updateEntity(false)
                .orIgnore()
                .execute()
              await db.getRepository(AiModelRoutingEntity).find({
                select: { model_id: true },
                where: { model_id: model.id },
                lock: { mode: 'pessimistic_write' },
              })
              const [active, configured] = await Promise.all([
                db
                  .getRepository(AiProviderLeaseEntity)
                  .countBy({
                    model_id: model.id,
                    expires_at: Raw(
                      (column) => `${column} >= UTC_TIMESTAMP(3)`,
                    ),
                  }),
                db
                  .getRepository(ModelEntity)
                  .findOne({
                    select: { maxConcurrency: true },
                    where: { id: model.id },
                  }),
              ])
              if (
                active >=
                (Number(configured?.maxConcurrency) || model.maxConcurrency)
              ) {
                return false
              }
            }
            await db.getRepository(AiProviderLeaseEntity).insert({
              id,
              provider_id: providerId,
              model_id: model?.id ?? null,
              expires_at: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND)',
            })
            return true
          }),
        signal,
      )
      if (acquired) {
        break
      }
      if (Date.now() >= deadline) {
        throw ErrorCode.PROVIDER_BUSY()
      }
      await delay(250, undefined, { signal })
    }
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
    }
    let renewal: Promise<void> | undefined
    const heartbeat = setInterval(() => {
      renewal ??= this.source
        .getRepository(AiProviderLeaseEntity)
        .update(
          {
            id,
            expires_at: Raw((column) => `${column} >= UTC_TIMESTAMP(3)`),
          },
          { expires_at: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND)' },
        )
        .then((result) => {
          if (!result.affected) {
            controller.abort('PROVIDER_LEASE_LOST')
          }
        })
        .catch(() => controller.abort('PROVIDER_LEASE_LOST'))
        .finally(() => (renewal = undefined))
    }, 25000)
    try {
      controller.signal.throwIfAborted()
      return await invoke(controller.signal)
    } catch (error) {
      if (controller.signal.reason === 'PROVIDER_LEASE_LOST') {
        throw ErrorCode.PROVIDER_LEASE_LOST()
      }
      throw error
    } finally {
      clearInterval(heartbeat)
      signal.removeEventListener('abort', abort)
      await renewal
      await this.leaseMutation(() =>
        this.source.getRepository(AiProviderLeaseEntity).delete({ id }),
      ).catch(() => console.warn('MODEL_SLOT_RELEASE_FAILED', id))
      // A leftover lease expires conservatively; never turn a successful/settled
      // provider result into a new request merely because cleanup failed.
    }
  }
}
