import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredLedgerAttachment {
  id: string
  ledger_id: string
  subject_id: string
  resource_id: string
  created_by: string | null
  created_at: string
  subject_kind: string
}

export const LedgerAttachmentEntity = new EntitySchema<StoredLedgerAttachment>({
  name: 'LedgerAttachment',
  tableName: 'ledger_attachments',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
    subject_id: { type: 'char', name: 'subject_id', length: 36 },
    resource_id: { type: 'char', name: 'resource_id', length: 36 },
    created_by: {
      type: 'char',
      name: 'created_by',
      length: 36,
      nullable: true,
    },
    created_at: {
      type: 'datetime',
      name: 'created_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    subject_kind: { type: 'varchar', name: 'subject_kind', length: 32 },
  },
  indices: [
    { name: 'idx_book', columns: ['ledger_id'] },
    {
      name: 'uq_record_resource',
      columns: ['ledger_id', 'subject_kind', 'subject_id', 'resource_id'],
      unique: true,
    },
  ],
})
