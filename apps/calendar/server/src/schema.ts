import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'
import { initialHolidaySchedule } from './holiday-seed.js'

export const calendarSchema: DatabaseSchema = {
  id: 'calendar',
  async seed(db) {
    await db.query('INSERT INTO calendar_holiday_settings(region,enabled,auto_publish) VALUES(\'CN\',TRUE,TRUE)')
    await db.query(
      `INSERT INTO calendar_holiday_years(region,year,published,candidate,revision,manual_override,published_at,updated_at)
       VALUES('CN',?,?,?,1,FALSE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [initialHolidaySchedule.year, JSON.stringify(initialHolidaySchedule), JSON.stringify(initialHolidaySchedule)],
    )
  },
  tables: [
    `CREATE TABLE calendar_events (
      id char(36) NOT NULL,
      user_id char(36) NOT NULL,
      title varchar(100) NOT NULL,
      data json NOT NULL,
      revision int NOT NULL DEFAULT '1',
      deleted tinyint(1) NOT NULL DEFAULT '0',
      created_at datetime(3) NOT NULL,
      updated_at datetime(3) NOT NULL,
      PRIMARY KEY (id),
      KEY calendar_owner (user_id,deleted),
      CONSTRAINT calendar_owner_fk FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE calendar_exceptions (
      event_id char(36) NOT NULL,
      date date NOT NULL,
      state varchar(20) NOT NULL,
      PRIMARY KEY (event_id,date),
      CONSTRAINT calendar_exception_fk FOREIGN KEY (event_id) REFERENCES calendar_events (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE calendar_holiday_audit (
      id char(36) NOT NULL,
      year int NOT NULL,
      action varchar(30) NOT NULL,
      actor_id varchar(36) DEFAULT NULL,
      revision int NOT NULL,
      data json NOT NULL,
      created_at datetime(3) NOT NULL,
      PRIMARY KEY (id),
      KEY holiday_audit_year (year,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE calendar_holiday_settings (
      region varchar(8) NOT NULL,
      enabled tinyint(1) NOT NULL DEFAULT '1',
      auto_publish tinyint(1) NOT NULL DEFAULT '1',
      PRIMARY KEY (region)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE calendar_holiday_years (
      region varchar(8) NOT NULL,
      year int NOT NULL,
      published json DEFAULT NULL,
      candidate json DEFAULT NULL,
      revision int NOT NULL DEFAULT '0',
      manual_override tinyint(1) NOT NULL DEFAULT '0',
      checked_at datetime(3) DEFAULT NULL,
      last_error varchar(400) DEFAULT NULL,
      published_at datetime(3) DEFAULT NULL,
      updated_at datetime(3) NOT NULL,
      updated_by varchar(36) DEFAULT NULL,
      PRIMARY KEY (region,year)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
}
