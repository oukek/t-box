import type { MigrationInterface, QueryRunner } from 'typeorm'

export class OperationsUtc1791244842000 implements MigrationInterface {
  async up(db: QueryRunner) {
    // Previous drafts used server-local defaults. Explicit runtime updates already
    // use UTC; only convert columns/rows known to have been initialized locally.
    await db.query('UPDATE operations_events SET created_at=TIMESTAMPADD(MICROSECOND,-TIMESTAMPDIFF(MICROSECOND,UTC_TIMESTAMP(3),CURRENT_TIMESTAMP(3)),created_at)')
    await db.query('UPDATE application_file_grants SET created_at=TIMESTAMPADD(MICROSECOND,-TIMESTAMPDIFF(MICROSECOND,UTC_TIMESTAMP(3),CURRENT_TIMESTAMP(3)),created_at)')
    await db.query(`UPDATE payment_refunds SET
      updated_at=IF(status='prepared' AND submitted=FALSE,TIMESTAMPADD(MICROSECOND,-TIMESTAMPDIFF(MICROSECOND,UTC_TIMESTAMP(3),CURRENT_TIMESTAMP(3)),updated_at),updated_at),
      next_query_at=IF(status='prepared' AND submitted=FALSE,TIMESTAMPADD(MICROSECOND,-TIMESTAMPDIFF(MICROSECOND,UTC_TIMESTAMP(3),CURRENT_TIMESTAMP(3)),next_query_at),next_query_at),
      created_at=TIMESTAMPADD(MICROSECOND,-TIMESTAMPDIFF(MICROSECOND,UTC_TIMESTAMP(3),CURRENT_TIMESTAMP(3)),created_at)`)
    await db.query('ALTER TABLE operations_events MODIFY created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))')
    await db.query('ALTER TABLE application_file_grants MODIFY created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))')
    await db.query('ALTER TABLE payment_refunds MODIFY next_query_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),MODIFY created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),MODIFY updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))')
  }

  async down(): Promise<void> {
    throw new Error('UTC timestamps must not be converted back to server-local time')
  }
}
