import type { MigrationInterface, QueryRunner } from 'typeorm'
/** Preserve existing history while making its protection independent of any application. */
export class ApplicationResources1791244803000 implements MigrationInterface {
  async up(db: QueryRunner) {
    if (await db.hasColumn('conversations', 'ledger_ids')) {
      await db.query(
        'ALTER TABLE conversations CHANGE ledger_ids resource_refs JSON NOT NULL',
      )
    }
    // MySQL DDL commits separately; this conversion is safe to repeat after interruption.
    const rows: { id: string, refs: string | unknown[] }[] = await db.query(
      'SELECT id,resource_refs AS refs FROM conversations',
    )
    for (const row of rows) {
      const refs: unknown[] =
        typeof row.refs === 'string' ? JSON.parse(row.refs) : row.refs
      if (refs.some((ref) => typeof ref === 'string')) {
        await db.query('UPDATE conversations SET resource_refs=? WHERE id=?', [
          JSON.stringify(
            refs.map((ref) =>
              typeof ref === 'string'
                ? { appId: 'ledger', resourceType: 'book', resourceId: ref }
                : ref,
            ),
          ),
          row.id,
        ])
      }
    }
  }

  async down(): Promise<void> {
    throw new Error(
      'History resource migration requires an explicit data backup before rollback',
    )
  }
}
