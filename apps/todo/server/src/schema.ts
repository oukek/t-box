import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'

export const todoSchema: DatabaseSchema = {
  id: 'todo',
  tables: [],
  extensions: [
    {
      id: '2026-11-25.todo',
      tables: [
        'CREATE TABLE todo_owners (subject char(64) PRIMARY KEY,generation int NOT NULL,active boolean NOT NULL,releaseId varchar(80) NOT NULL,version int NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        'CREATE TABLE todo_entries (subject char(64) NOT NULL,id varchar(48) NOT NULL,revision int NOT NULL,created varchar(24) NOT NULL,item json NOT NULL,PRIMARY KEY(subject,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        'CREATE TABLE todo_receipts (subject char(64) NOT NULL,`key` char(64) NOT NULL,hash char(64) NOT NULL,response json NOT NULL,PRIMARY KEY(subject,`key`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
      ],
    },
  ],
}
