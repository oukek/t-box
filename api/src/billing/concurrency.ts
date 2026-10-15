import type { ConfigurationSnapshot } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { ApiError } from '@t-box/server-foundation/errors'
import { settingNumber } from '../configuration/defaults.js'

/** Cross-process provider slots. A slot is held until the actual request settles, including abort cleanup. */
export class ProviderConcurrency {
  constructor(readonly source: DataSource) {}
  async run<T>(
    providerId: string,
    signal: AbortSignal,
    configuration: ConfigurationSnapshot | undefined,
    invoke: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const limit = settingNumber(configuration, 'ai.provider.concurrency', 8)
    const deadline =
      Date.now() +
      settingNumber(configuration, 'ai.provider.queueTimeoutMs', 30000)
    const id = randomUUID()
    while (true) {
      signal.throwIfAborted()
      const acquired = await this.source.transaction(
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
          await db.query(
            'DELETE FROM ai_provider_leases WHERE provider_id=? AND expires_at<UTC_TIMESTAMP(3)',
            [providerId],
          )
          const [row] = await db.query(
            'SELECT COUNT(*) AS count FROM ai_provider_leases WHERE provider_id=?',
            [providerId],
          )
          if (Number(row.count) >= limit) {
            return false
          }
          await db.query(
            'INSERT INTO ai_provider_leases(id,provider_id,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND))',
            [id, providerId],
          )
          return true
        },
      )
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
      await this.source.query('DELETE FROM ai_provider_leases WHERE id=?', [id])
    }
  }
}
