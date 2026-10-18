import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredUserRecoveryCode {
  user_id: string
  code_hash: string
  used_at: string | null
  created_at: string
}

export const UserRecoveryCodeEntity = new EntitySchema<StoredUserRecoveryCode>({
  name: 'UserRecoveryCode',
  tableName: 'user_recovery_codes',
  columns: {
    user_id: { type: 'char', name: 'user_id', length: 36, primary: true },
    code_hash: { type: 'char', name: 'code_hash', length: 64, primary: true },
    used_at: {
      type: 'datetime',
      name: 'used_at',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    created_at: {
      type: 'datetime',
      name: 'created_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
  },
  indices: [],
})
