import type { ConfigurationSnapshot } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { ApiError } from '@t-box/server-foundation/errors'
import { settingNumber } from '../configuration/defaults.js'

/** Cross-process provider slots. A slot is held until the actual request settles, including abort cleanup. */
export class ProviderConcurrency {
  constructor(readonly source: DataSource) {}

  /** Retry only database lease mutations, never the provider callback or billing. */
  private async leaseMutation<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await work()
      } catch (error) {
        const code = (error as { code?: string } | undefined)?.code
        if (attempt >= 2 || !['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code || '')) {
          throw error
        }
        await delay(25 * (attempt + 1), undefined, { signal })
      }
    }
  }

  private async cleanupExpired(providerId: string) {
    const rows: { id: string }[] = await this.source.query('SELECT id FROM ai_provider_leases WHERE provider_id=? AND expires_at<UTC_TIMESTAMP(3) LIMIT 128', [providerId])
    // Match release/renewal's primary-key lock order; a secondary-index range DELETE
    // can deadlock a request finishing through the primary key.
    for (const { id } of rows) {
      await this.leaseMutation(() => this.source.query('DELETE FROM ai_provider_leases WHERE id=? AND expires_at<UTC_TIMESTAMP(3)', [id]))
    }
  }

  async run<T>(
    providerId: string,
    signal: AbortSignal,
    configuration: ConfigurationSnapshot | undefined,
    invoke: (signal: AbortSignal) => Promise<T>,
    model?: { id: string, maxConcurrency: number, providerConcurrency?: number },
  ): Promise<T> {
    const defaultLimit = model?.providerConcurrency || settingNumber(configuration, 'ai.provider.concurrency', 8)
    const deadline =
      Date.now() +
      settingNumber(configuration, 'ai.provider.queueTimeoutMs', 30000)
    const id = randomUUID()
    await this.cleanupExpired(providerId)
    while (true) {
      signal.throwIfAborted()
      const acquired = await this.leaseMutation(() => this.source.transaction(
        'READ COMMITTED',
        async (db) => {
          await db.query(
            'INSERT INTO ai_provider_pools(provider_id) VALUES(?) ON DUPLICATE KEY UPDATE provider_id=VALUES(provider_id)',
            [providerId],
          )
          await db.query(
            'SELECT provider_id FROM ai_provider_pools WHERE provider_id=? FOR UPDATE',
            [providerId],
          )
          const [row] = await db.query(
            'SELECT COUNT(*) AS count FROM ai_provider_leases WHERE provider_id=? AND expires_at>=UTC_TIMESTAMP(3)',
            [providerId],
          )
          const [provider] = await db.query('SELECT max_concurrency FROM ai_providers WHERE id=?', [providerId])
          const limit = Number(provider?.max_concurrency) || defaultLimit
          if (Number(row.count) >= limit) {
            return false
          }
          if (model) {
            await db.query('INSERT IGNORE INTO ai_model_routing(model_id) VALUES(?)', [model.id])
            await db.query('SELECT model_id FROM ai_model_routing WHERE model_id=? FOR UPDATE', [model.id])
            const [[active], [configured]] = await Promise.all([
              db.query('SELECT COUNT(*) AS count FROM ai_provider_leases WHERE model_id=? AND expires_at>=UTC_TIMESTAMP(3)', [model.id]),
              db.query('SELECT max_concurrency FROM ai_models WHERE id=?', [model.id]),
            ])
            if (Number(active.count) >= (Number(configured?.max_concurrency) || model.maxConcurrency)) {
              return false
            }
          }
          await db.query(
            'INSERT INTO ai_provider_leases(id,provider_id,model_id,expires_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND))',
            [id, providerId, model?.id ?? null],
          )
          return true
        },
      ), signal)
      if (acquired) {
        break
      }
      if (Date.now() >= deadline) {
        throw new ApiError(
          429,
          'PROVIDER_BUSY',
          '模型服务当前繁忙，请稍后继续；已完成的操作仍保留',
        )
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
        .query(
          'UPDATE ai_provider_leases SET expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND) WHERE id=? AND expires_at>=UTC_TIMESTAMP(3)',
          [id],
        )
        .then((result) => {
          if (!result.affectedRows) {
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
        throw new ApiError(
          503,
          'PROVIDER_LEASE_LOST',
          '模型请求的执行租约已失效，用量保留待核对，请稍后继续',
        )
      }
      throw error
    } finally {
      clearInterval(heartbeat)
      signal.removeEventListener('abort', abort)
      await renewal
      await this.leaseMutation(() => this.source.query('DELETE FROM ai_provider_leases WHERE id=?', [id]))
        .catch(() => console.warn('MODEL_SLOT_RELEASE_FAILED', id))
      // A leftover lease expires conservatively; never turn a successful/settled
      // provider result into a new request merely because cleanup failed.
    }
  }
}
