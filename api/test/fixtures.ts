import type { DataSource } from 'typeorm'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ResourceService } from '../src/resources/service.js'

/** Shared guard for suites that mutate an explicitly selected disposable schema. */
export function assertDisposableDatabase(database: unknown): asserts database is string {
  if (typeof database !== 'string' || database !== database.trim() || !/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(database)) {
    throw new Error('Use a disposable MYSQL_DATABASE=t_box_ci or t_box_test_<name>')
  }
}

/** Delete only ledgers owned by explicitly supplied disposable test identities. */
export async function cleanupUsers(source: DataSource, userIds: string[]) {
  if (!userIds.length) {
    return
  }
  const books = await source.query(
    `SELECT id FROM ledgers WHERE owner_id IN (${userIds.map(() => '?').join(',')})`,
    userIds,
  )
  for (const { id } of books) {
    for (const table of [
      'ledger_operations',
      'ledger_audit',
      'ledger_daily_categories',
      'ledger_daily_stats',
      'ledger_events',
      'settlement_allocations',
      'debt_settlements',
      'debt_positions',
      'bills',
      'bill_categories',
      'ledger_unlocks',
      'ledger_invites',
      'ledger_members',
    ]) {
      await source.query(`DELETE FROM ${table} WHERE ledger_id=?`, [id])
    }
    await source.query('DELETE FROM ledgers WHERE id=?', [id])
  }
  for (const id of userIds) {
    const files = await source.query(
      'SELECT id FROM resources WHERE user_id=?',
      [id],
    )
    const root = new ResourceService(source).root
    for (const file of files) {
      await unlink(join(root, file.id)).catch(() => {})
    }
    await source.query('DELETE FROM resources WHERE user_id=?', [id])
    await source.query('DELETE FROM agent_tasks WHERE user_id=?', [id])
    await source.query('DELETE FROM conversations WHERE user_id=?', [id])
    await source.query('DELETE FROM ledger_members WHERE user_id=?', [id])
    await source.query('DELETE FROM user_sessions WHERE user_id=?', [id])
    await source.query('DELETE FROM app_users WHERE id=?', [id])
  }
}
