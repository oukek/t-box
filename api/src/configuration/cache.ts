import type { DataSource } from 'typeorm'
import { createHash } from 'node:crypto'
import { PlatformConfigurationStateEntity } from '../db/records/configuration-entities.js'
import { ErrorCode } from '../error-codes.js'

export interface ConfigurationRedis {
  readonly isReady: boolean
  get(key: string): Promise<string | null>
  set(key: string, value: string, options: { EX: number }): Promise<unknown>
}
/**
 * Immutable revision keys prevent a late cache fill from resurrecting an old value.
 * Redis contains only public configuration or encrypted secrets, never decrypted credentials.
 */
export class ConfigurationCache {
  ttlSeconds = 300
  constructor(
    private readonly redis?: ConfigurationRedis,
    private readonly namespace = 't-box',
  ) {}

  async current<T>(
    source: Pick<DataSource, 'getRepository'>,
    scope: string,
    load: () => Promise<T>,
    ai = false,
  ): Promise<T> {
    const row = await source
      .getRepository(PlatformConfigurationStateEntity)
      .findOne({
        select: ai
          ? { id: true, ai_revision: true }
          : { id: true, revision: true },
        where: { id: 1 },
      })
    return this.read(
      scope,
      Number((ai ? row?.ai_revision : row?.revision) ?? 0),
      load,
    )
  }

  async read<T>(
    scope: string,
    revision: string | number,
    load: () => Promise<T>,
  ): Promise<T> {
    const key = `${this.namespace}:config:${scope}:${createHash('sha256').update(String(revision)).digest('hex')}`
    const bounded = <T>(work: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout>
      return Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(ErrorCode.INTERNAL_CACHE_TIMEOUT()),
            150,
          )
        }),
      ]).finally(() => clearTimeout(timer))
    }
    if (this.redis?.isReady) {
      try {
        const cached = await bounded(this.redis.get(key))
        if (cached !== null) {
          return JSON.parse(cached) as T
        }
      } catch {
        /* MySQL remains authoritative when Redis is unavailable or corrupt. */
      }
    }
    const value = await load()
    if (this.redis?.isReady) {
      try {
        await bounded(
          this.redis.set(key, JSON.stringify(value), { EX: this.ttlSeconds }),
        )
      } catch {
        /* Never turn a cache write into a configuration failure. */
      }
    }
    return value
  }
}
