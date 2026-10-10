import type { MigrationInterface, QueryRunner } from 'typeorm'

export class CalendarTime1791244816000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(
      `CREATE TABLE calendar_events(id CHAR(36) PRIMARY KEY,user_id CHAR(36) NOT NULL,title VARCHAR(100) NOT NULL,data JSON NOT NULL,revision INT NOT NULL DEFAULT 1,deleted BOOLEAN NOT NULL DEFAULT FALSE,created_at DATETIME(3) NOT NULL,updated_at DATETIME(3) NOT NULL,INDEX calendar_owner(user_id,deleted),CONSTRAINT calendar_owner_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    )
    await db.query(
      `CREATE TABLE calendar_exceptions(event_id CHAR(36) NOT NULL,date DATE NOT NULL,state VARCHAR(20) NOT NULL,PRIMARY KEY(event_id,date),CONSTRAINT calendar_exception_fk FOREIGN KEY(event_id) REFERENCES calendar_events(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    )
    await db.query(
      `CREATE TABLE app_timers(id CHAR(36) PRIMARY KEY,user_id CHAR(36) NOT NULL,data JSON NOT NULL,revision INT NOT NULL DEFAULT 1,deleted BOOLEAN NOT NULL DEFAULT FALSE,created_at DATETIME(3) NOT NULL,INDEX timer_owner(user_id,deleted),CONSTRAINT timer_owner_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    )
    await db.query(
      `CREATE TABLE application_operations(user_id CHAR(36) NOT NULL,app_id VARCHAR(40) NOT NULL,operation_key CHAR(64) NOT NULL,payload_hash CHAR(64) NOT NULL,response JSON NOT NULL,created_at DATETIME(3) NOT NULL,PRIMARY KEY(user_id,app_id,operation_key),CONSTRAINT app_operation_owner_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    )
  }

  async down() {
    throw new Error(
      'Calendar/time user data requires an explicit export before rollback',
    )
  }
}
