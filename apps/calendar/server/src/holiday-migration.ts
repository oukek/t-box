import type { MigrationInterface, QueryRunner } from 'typeorm'
// Bootstrap the previously verified 2026 schedule; later annual updates live exclusively in the database.
const seed = {
  year: 2026,
  papers: ['https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm'],
  days: [
    { date: '2026-01-01', name: '元旦', status: 'rest' },
    { date: '2026-01-02', name: '元旦', status: 'rest' },
    { date: '2026-01-03', name: '元旦', status: 'rest' },
    { date: '2026-01-04', name: '元旦', status: 'work' },
    { date: '2026-02-14', name: '春节', status: 'work' },
    { date: '2026-02-15', name: '春节', status: 'rest' },
    { date: '2026-02-16', name: '春节', status: 'rest' },
    { date: '2026-02-17', name: '春节', status: 'rest' },
    { date: '2026-02-18', name: '春节', status: 'rest' },
    { date: '2026-02-19', name: '春节', status: 'rest' },
    { date: '2026-02-20', name: '春节', status: 'rest' },
    { date: '2026-02-21', name: '春节', status: 'rest' },
    { date: '2026-02-22', name: '春节', status: 'rest' },
    { date: '2026-02-23', name: '春节', status: 'rest' },
    { date: '2026-02-28', name: '春节', status: 'work' },
    { date: '2026-04-04', name: '清明节', status: 'rest' },
    { date: '2026-04-05', name: '清明节', status: 'rest' },
    { date: '2026-04-06', name: '清明节', status: 'rest' },
    { date: '2026-05-01', name: '劳动节', status: 'rest' },
    { date: '2026-05-02', name: '劳动节', status: 'rest' },
    { date: '2026-05-03', name: '劳动节', status: 'rest' },
    { date: '2026-05-04', name: '劳动节', status: 'rest' },
    { date: '2026-05-05', name: '劳动节', status: 'rest' },
    { date: '2026-05-09', name: '劳动节', status: 'work' },
    { date: '2026-06-19', name: '端午节', status: 'rest' },
    { date: '2026-06-20', name: '端午节', status: 'rest' },
    { date: '2026-06-21', name: '端午节', status: 'rest' },
    { date: '2026-09-20', name: '国庆节', status: 'work' },
    { date: '2026-09-25', name: '中秋节', status: 'rest' },
    { date: '2026-09-26', name: '中秋节', status: 'rest' },
    { date: '2026-09-27', name: '中秋节', status: 'rest' },
    { date: '2026-10-01', name: '国庆节', status: 'rest' },
    { date: '2026-10-02', name: '国庆节', status: 'rest' },
    { date: '2026-10-03', name: '国庆节', status: 'rest' },
    { date: '2026-10-04', name: '国庆节', status: 'rest' },
    { date: '2026-10-05', name: '国庆节', status: 'rest' },
    { date: '2026-10-06', name: '国庆节', status: 'rest' },
    { date: '2026-10-07', name: '国庆节', status: 'rest' },
    { date: '2026-10-10', name: '国庆节', status: 'work' },
  ],
}
export class CalendarHolidayYears1791244822000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(
      `CREATE TABLE calendar_holiday_years(region VARCHAR(8) NOT NULL,year INT NOT NULL,published JSON NULL,candidate JSON NULL,revision INT NOT NULL DEFAULT 0,manual_override BOOLEAN NOT NULL DEFAULT FALSE,checked_at DATETIME(3) NULL,last_error VARCHAR(400) NULL,published_at DATETIME(3) NULL,updated_at DATETIME(3) NOT NULL,updated_by VARCHAR(36) NULL,PRIMARY KEY(region,year)) ENGINE=InnoDB`,
    )
    await db.query(
      `CREATE TABLE calendar_holiday_settings(region VARCHAR(8) PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT TRUE,auto_publish BOOLEAN NOT NULL DEFAULT TRUE) ENGINE=InnoDB`,
    )
    await db.query(
      `CREATE TABLE calendar_holiday_audit(id CHAR(36) PRIMARY KEY,year INT NOT NULL,action VARCHAR(30) NOT NULL,actor_id VARCHAR(36) NULL,revision INT NOT NULL,data JSON NOT NULL,created_at DATETIME(3) NOT NULL,INDEX holiday_audit_year(year,created_at)) ENGINE=InnoDB`,
    )
    await db.query(
      `INSERT INTO calendar_holiday_settings(region,enabled,auto_publish) VALUES('CN',TRUE,TRUE)`,
    )
    await db.query(
      `INSERT INTO calendar_holiday_years(region,year,published,candidate,revision,manual_override,published_at,updated_at) VALUES('CN',2026,?,?,1,FALSE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [JSON.stringify(seed), JSON.stringify(seed)],
    )
  }

  async down() {
    throw new Error(
      'Holiday publication history requires explicit export before rollback',
    )
  }
}
