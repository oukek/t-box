import type { MigrationInterface, QueryRunner } from 'typeorm'
import { upgradeRechargeConfiguration } from '../../payments/recharge.js'

export class RechargeCatalog1791244815000 implements MigrationInterface {
  async up(db: QueryRunner) {
    const rows: { id: number, configuration: unknown }[] = await db.query(
      'SELECT id,configuration FROM recharge_settings',
    )
    for (const row of rows) {
      const config =
        typeof row.configuration === 'string'
          ? JSON.parse(row.configuration)
          : row.configuration
      if (
        typeof config.customEnabled !== 'boolean' ||
        config.presets.some((p: unknown) => typeof p === 'string')
      ) {
        await db.query(
          'UPDATE recharge_settings SET configuration=?,revision=revision+1 WHERE id=?',
          [JSON.stringify(upgradeRechargeConfiguration(config)), row.id],
        )
      }
    }
  }

  async down(): Promise<void> {
    throw new Error(
      'Recharge catalog changes require an explicit policy migration before rollback',
    )
  }
}
