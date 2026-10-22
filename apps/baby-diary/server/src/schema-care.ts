/** Typed event headers and app-owned details; historical revisions are append-only. */
export const babyCareTables = [
  `CREATE TABLE baby_diary_care (
    id char(36) NOT NULL,
    baby_id char(36) NOT NULL,
    kind varchar(12) NOT NULL,
    occurred_at datetime(3) NOT NULL,
    ended_at datetime(3) DEFAULT NULL,
    state varchar(12) NOT NULL,
    active_slot varchar(12) DEFAULT NULL,
    note varchar(500) NOT NULL,
    author char(64) NOT NULL,
    author_name varchar(40) NOT NULL,
    revision int NOT NULL,
    created_at datetime(3) NOT NULL,
    updated_at datetime(3) NOT NULL,
    deleted_at datetime(3) DEFAULT NULL,
    PRIMARY KEY (id),
    KEY baby_care_timeline (baby_id,deleted_at,occurred_at),
    UNIQUE KEY baby_care_active (baby_id,active_slot)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE baby_diary_feedings (
    event_id char(36) NOT NULL,
    parts json NOT NULL,
    PRIMARY KEY (event_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE baby_diary_diapers (
    event_id char(36) NOT NULL,
    contents varchar(12) NOT NULL,
    PRIMARY KEY (event_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE baby_diary_care_revisions (
    event_id char(36) NOT NULL,
    revision int NOT NULL,
    actor char(64) NOT NULL,
    snapshot json NOT NULL,
    created_at datetime(3) NOT NULL,
    PRIMARY KEY (event_id,revision)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]
