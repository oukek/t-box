import type { ConfigurationRedis } from '../configuration/cache.js'
import type { MemoryRow } from '../db/records/memory-entities.js'
import { clearTimeout, setTimeout } from 'node:timers'
/** Private user data has its own namespace and always requires the authoritative revision. */
export class MemoryCache {
  constructor(
    private readonly redis?: ConfigurationRedis,
    private readonly namespace = 't-box',
  ) {}

  async read(
    userId: string,
    revision: number,
    load: () => Promise<MemoryRow[]>,
  ): Promise<MemoryRow[]> {
    const key = `${this.namespace}:memory:${userId}:${revision}`
    const bounded = async <T>(work: Promise<T>) => {
      let cancel: (() => void) | undefined
      try {
        return await Promise.race([
          work,
          new Promise<undefined>((resolve) => {
            const timer = setTimeout(resolve, 100, undefined)
            cancel = () => clearTimeout(timer)
          }),
        ])
      } finally {
        cancel?.()
      }
    }
    if (this.redis?.isReady) {
      try {
        const cached = await bounded(this.redis.get(key))
        if (cached) {
          const rows: unknown = JSON.parse(cached)
          if (
            Array.isArray(rows) &&
            rows.every(
              (row: unknown) =>
                row &&
                typeof row === 'object' &&
                'userId' in row &&
                row.userId === userId &&
                'content' in row &&
                typeof row.content === 'string',
            )
          ) {
            return rows as MemoryRow[]
          }
        }
      } catch {
        /* Cache failure cannot replace authoritative storage. */
      }
    }
    const rows = await load()
    if (this.redis?.isReady) {
      try {
        await bounded(this.redis.set(key, JSON.stringify(rows), { EX: 60 }))
      } catch {
        /* Immutable keys expire. */
      }
    }
    return rows
  }
}
