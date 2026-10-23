import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'
import { randomUUID } from 'node:crypto'
import { initialPackages, initialTariff } from '../../billing/quota/defaults.js'

const suffix =
  ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
export const quotaSchema: DatabaseSchema = {
  id: 'ai-quota',
  tables: [
    `CREATE TABLE ai_quota_products (id char(36) NOT NULL PRIMARY KEY, code varchar(40) NOT NULL UNIQUE, draft json NOT NULL, currentVersion int NOT NULL DEFAULT 0, revision int NOT NULL DEFAULT 1)${suffix}`,
    `CREATE TABLE ai_quota_product_versions (id char(36) NOT NULL PRIMARY KEY, productId char(36) NOT NULL, version int NOT NULL, configuration json NOT NULL, createdAt datetime(3) NOT NULL, UNIQUE KEY product_version(productId,version), CONSTRAINT quota_product_version_fk FOREIGN KEY(productId) REFERENCES ai_quota_products (id))${suffix}`,
    `CREATE TABLE ai_quota_tariffs (version int NOT NULL PRIMARY KEY, configuration json NOT NULL, administratorId char(36) NULL, createdAt datetime(3) NOT NULL)${suffix}`,
    `CREATE TABLE ai_quota_accounts (userId char(36) NOT NULL PRIMARY KEY, mode enum('charge','record_only') NOT NULL DEFAULT 'charge', revision int NOT NULL DEFAULT 1, CONSTRAINT quota_account_user FOREIGN KEY(userId) REFERENCES app_users (id) ON DELETE CASCADE)${suffix}`,
    `CREATE TABLE ai_quota_lots (id char(36) NOT NULL PRIMARY KEY, userId char(36) NOT NULL, sourceKey varchar(150) NOT NULL UNIQUE, source varchar(20) NOT NULL, name varchar(80) NOT NULL, total bigint NOT NULL DEFAULT 0, available bigint NOT NULL DEFAULT 0, reserved bigint NOT NULL DEFAULT 0, consumed bigint NOT NULL DEFAULT 0, expired bigint NOT NULL DEFAULT 0, revoked bigint NOT NULL DEFAULT 0, expiresAt datetime(3) NOT NULL, createdAt datetime(3) NOT NULL, orderId char(36) NULL, packageVersionId char(36) NULL, KEY quota_lot_user(userId,expiresAt,createdAt), KEY quota_lot_order(orderId), CONSTRAINT quota_lot_user_fk FOREIGN KEY(userId) REFERENCES app_users (id) ON DELETE CASCADE, CONSTRAINT quota_lot_nonnegative CHECK(total>=0 AND available>=0 AND reserved>=0 AND consumed>=0 AND expired>=0 AND revoked>=0), CONSTRAINT quota_lot_balance CHECK(total=available+reserved+consumed+expired+revoked))${suffix}`,
    `CREATE TABLE ai_quota_allocations (id char(36) NOT NULL PRIMARY KEY, reference varchar(100) NOT NULL, userId char(36) NOT NULL, lotId char(36) NOT NULL, allocated bigint NOT NULL DEFAULT 0, reserved bigint NOT NULL DEFAULT 0, consumed bigint NOT NULL DEFAULT 0, released bigint NOT NULL DEFAULT 0, returned bigint NOT NULL DEFAULT 0, createdAt datetime(3) NOT NULL, UNIQUE KEY quota_allocation_ref(reference,lotId), KEY quota_allocation_user(userId,reference), CONSTRAINT quota_allocation_lot FOREIGN KEY(lotId) REFERENCES ai_quota_lots (id) ON DELETE CASCADE, CONSTRAINT quota_allocation_balance CHECK(allocated=reserved+consumed+released AND reserved>=0 AND consumed>=0 AND released>=0 AND returned>=0 AND returned<=consumed))${suffix}`,
    `CREATE TABLE ai_quota_entries (id char(36) NOT NULL PRIMARY KEY, userId char(36) NOT NULL, lotId char(36) NULL, reference varchar(220) NOT NULL UNIQUE, kind varchar(20) NOT NULL, amount bigint NOT NULL, reason varchar(200) NOT NULL, createdAt datetime(3) NOT NULL, KEY quota_entry_user(userId,createdAt), CONSTRAINT quota_entry_user_fk FOREIGN KEY(userId) REFERENCES app_users (id) ON DELETE CASCADE)${suffix}`,
  ],
  async seed(db) {
    for (const draft of initialPackages) {
      const id = randomUUID()
      await db.query(
        'INSERT INTO ai_quota_products(id,code,draft,currentVersion) VALUES(?,?,?,1)',
        [id, draft.code, JSON.stringify(draft)],
      )
      await db.query(
        'INSERT INTO ai_quota_product_versions(id,productId,version,configuration,createdAt) VALUES(?,?,1,?,UTC_TIMESTAMP(3))',
        [randomUUID(), id, JSON.stringify(draft)],
      )
    }
    await db.query(
      'INSERT INTO ai_quota_tariffs(version,configuration,createdAt) VALUES(1,?,UTC_TIMESTAMP(3))',
      [JSON.stringify(initialTariff)],
    )
  },
}
