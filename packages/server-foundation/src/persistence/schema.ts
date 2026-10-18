import type { QueryRunner } from 'typeorm'

/** Application schemas stay in their own server packages; the host only composes them. */
export interface DatabaseSchema {
  id: string
  tables: readonly string[]
  seed?: (db: QueryRunner) => Promise<void>
}
