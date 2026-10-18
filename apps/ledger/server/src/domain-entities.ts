import type { JsonDocument } from '@t-box/server-foundation/persistence/columns'
import type {
  EntitySchemaColumnOptions,
  EntitySchemaOptions,
  ObjectLiteral,
} from 'typeorm'
import { EntitySchema } from 'typeorm'

const id: EntitySchemaColumnOptions = {
  type: 'char',
  length: 36,
  primary: true,
}
const reference: EntitySchemaColumnOptions = { type: 'char', length: 36 }
const created: EntitySchemaColumnOptions = {
  type: 'datetime',
  precision: 3,
  default: () => '(UTC_TIMESTAMP(3))',
}
const secret: EntitySchemaColumnOptions = {
  type: 'varchar',
  length: 200,
  select: false,
}
const amount: EntitySchemaColumnOptions = {
  type: 'decimal',
  precision: 11,
  scale: 2,
}
const total: EntitySchemaColumnOptions = {
  type: 'decimal',
  precision: 20,
  scale: 2,
  default: 0,
}
const kinds = [
  'income',
  'expense',
  'lend',
  'borrow',
  'collect',
  'repay',
  'correction',
  'refund',
  'transfer',
  'writeoff',
  'reimbursement',
]
const direction: EntitySchemaColumnOptions = {
  type: 'enum',
  enum: ['receivable', 'payable'],
}
const note: EntitySchemaColumnOptions = {
  type: 'varchar',
  length: 200,
  default: '',
}
const date: EntitySchemaColumnOptions = { type: 'date' }
const boolean: EntitySchemaColumnOptions = { type: Boolean, default: false }
const table = <T extends ObjectLiteral>(
  name: string,
  tableName: string,
  columns: EntitySchemaOptions<T>['columns'],
) => new EntitySchema<T>({ name, tableName, columns })
export interface StoredLedger {
  id: string
  name: string
  template: 'daily' | 'debt' | 'combined'
  currency: 'CNY'
  ownerId: string | null
  archived: boolean
  passwordHash: string | null
  passwordVersion: number
  revision: string
  createdAt: Date | string
}

export interface StoredLedgerMember {
  ledgerId: string
  userId: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  joinedAt: Date | string
}

export interface StoredLedgerInvite {
  id: string
  ledgerId: string
  tokenHash: string
  role: 'admin' | 'editor' | 'viewer'
  expiresAt: Date | string
  maxUses: number
  uses: number
  revoked: boolean
  createdBy: string
}

export interface StoredLedgerUnlock {
  ledgerId: string
  sessionHash: string
  passwordVersion: number
  expiresAt: Date | string
  scope: 'read' | 'write'
}

export interface StoredLedgerOperation {
  id: string
  ledgerId: string
  userId: string
  requestKey: string
  payloadHash: string
  action: string
  result: JsonDocument
  createdAt: Date | string
}

export interface StoredLedgerAudit {
  id: string
  ledgerId: string
  userId: string | null
  action: string
  subjectId: string | null
  details: JsonDocument
  createdAt: Date | string
}

export interface StoredDebtPosition {
  id: string
  ledgerId: string
  direction: 'receivable' | 'payable'
  counterparty: string
  amount: string
  settled: string
  remaining: string
  date: string
  dueDate: string | null
  note: string
  cashMovement: boolean
  createdBy: string
  createdAt: Date | string
  accountId: string | null
  contactId: string | null
  adjusted: string
}

export interface StoredDebtSettlement {
  id: string
  ledgerId: string
  direction: 'receivable' | 'payable'
  counterparty: string
  amount: string
  date: string
  note: string
  createdBy: string
  reversed: boolean
  createdAt: Date | string
  accountId: string | null
}

export interface StoredSettlementAllocation {
  ledgerId: string
  settlementId: string
  debtId: string
  amount: string
}

export interface StoredLedgerEvent {
  id: string
  ledgerId: string
  subjectId: string
  kind:
    | 'income' |
    'expense' |
    'lend' |
    'borrow' |
    'collect' |
    'repay' |
    'correction' |
    'refund' |
    'transfer' |
    'writeoff' |
    'reimbursement'
  date: string
  income: string
  expense: string
  cashIn: string
  cashOut: string
  receivableDelta: string
  payableDelta: string
  count: number
  categoryId: string | null
  billType: 'income' | 'expense' | null
  note: string
  createdBy: string | null
  createdAt: Date | string
}

export interface StoredLedgerDailyStats {
  ledgerId: string
  date: string
  income: string
  expense: string
  cashIn: string
  cashOut: string
  receivableDelta: string
  payableDelta: string
  count: string | number
}

export interface StoredLedgerDailyCategory {
  ledgerId: string
  date: string
  categoryId: string
  type: 'income' | 'expense'
  amount: string
  count: string | number
}

export const LedgerEntity = table<StoredLedger>('Ledger', 'ledgers', {
  id,
  name: { type: 'varchar', length: 40 },
  template: { type: 'enum', enum: ['daily', 'debt', 'combined'] },
  currency: { type: 'char', length: 3, default: 'CNY' },
  ownerId: { ...reference, name: 'owner_id', nullable: true },
  archived: boolean,
  passwordHash: { ...secret, name: 'password_hash', nullable: true },
  passwordVersion: { type: Number, name: 'password_version', default: 1 },
  revision: { type: 'bigint', default: 0 },
  createdAt: { ...created, name: 'created_at' },
})

export const LedgerMemberEntity = table<StoredLedgerMember>(
  'LedgerMember',
  'ledger_members',
  {
    ledgerId: { ...reference, name: 'ledger_id', primary: true },
    userId: { ...reference, name: 'user_id', primary: true },
    role: { type: 'enum', enum: ['owner', 'admin', 'editor', 'viewer'] },
    joinedAt: { ...created, name: 'joined_at' },
  },
)

export const LedgerInviteEntity = table<StoredLedgerInvite>(
  'LedgerInvite',
  'ledger_invites',
  {
    id,
    ledgerId: { ...reference, name: 'ledger_id' },
    tokenHash: {
      type: 'char',
      length: 64,
      name: 'token_hash',
      select: false,
      unique: true,
    },
    role: { type: 'enum', enum: ['admin', 'editor', 'viewer'] },
    expiresAt: { type: 'datetime', precision: 3, name: 'expires_at' },
    maxUses: { type: Number, name: 'max_uses' },
    uses: { type: Number, default: 0 },
    revoked: boolean,
    createdBy: { ...reference, name: 'created_by' },
  },
)

export const LedgerUnlockEntity = table<StoredLedgerUnlock>(
  'LedgerUnlock',
  'ledger_unlocks',
  {
    scope: { type: 'enum', enum: ['read', 'write'], default: 'write' },
    ledgerId: { ...reference, name: 'ledger_id', primary: true },
    sessionHash: {
      type: 'char',
      length: 64,
      name: 'session_hash',
      primary: true,
      select: false,
    },
    passwordVersion: { type: Number, name: 'password_version' },
    expiresAt: { type: 'datetime', precision: 3, name: 'expires_at' },
  },
)

export const LedgerOperationEntity = table<StoredLedgerOperation>(
  'LedgerOperation',
  'ledger_operations',
  {
    id,
    ledgerId: { ...reference, name: 'ledger_id' },
    userId: { ...reference, name: 'user_id' },
    requestKey: { type: 'varchar', length: 128, name: 'request_key' },
    payloadHash: { type: 'char', length: 64, name: 'payload_hash' },
    action: { type: 'varchar', length: 50 },
    result: { type: 'json', name: 'result_json' },
    createdAt: { ...created, name: 'created_at' },
  },
)

export const LedgerAuditEntity = table<StoredLedgerAudit>(
  'LedgerAudit',
  'ledger_audit',
  {
    id,
    ledgerId: { ...reference, name: 'ledger_id' },
    userId: { ...reference, name: 'user_id', nullable: true },
    action: { type: 'varchar', length: 50 },
    subjectId: {
      type: 'varchar',
      length: 64,
      name: 'subject_id',
      nullable: true,
    },
    details: { type: 'json' },
    createdAt: { ...created, name: 'created_at' },
  },
)

export const DebtPositionEntity = table<StoredDebtPosition>(
  'DebtPosition',
  'debt_positions',
  {
    accountId: { ...reference, name: 'account_id', nullable: true },
    contactId: { ...reference, name: 'contact_id', nullable: true },
    adjusted: { ...amount, default: 0 },
    id,
    ledgerId: { ...reference, name: 'ledger_id' },
    direction,
    counterparty: { type: 'varchar', length: 80 },
    amount,
    settled: { ...amount, default: 0 },
    remaining: amount,
    date: { ...date, name: 'occurred_date' },
    dueDate: { ...date, name: 'due_date', nullable: true },
    note,
    cashMovement: { type: Boolean, name: 'cash_movement' },
    createdBy: { ...reference, name: 'created_by' },
    createdAt: { ...created, name: 'created_at' },
  },
)

export const DebtSettlementEntity = table<StoredDebtSettlement>(
  'DebtSettlement',
  'debt_settlements',
  {
    accountId: { ...reference, name: 'account_id', nullable: true },
    id,
    ledgerId: { ...reference, name: 'ledger_id' },
    direction,
    counterparty: { type: 'varchar', length: 80 },
    amount: { ...amount, precision: 14 },
    date: { ...date, name: 'settled_date' },
    note,
    createdBy: { ...reference, name: 'created_by' },
    reversed: boolean,
    createdAt: { ...created, name: 'created_at' },
  },
)

export const SettlementAllocationEntity = table<StoredSettlementAllocation>(
  'SettlementAllocation',
  'settlement_allocations',
  {
    ledgerId: { ...reference, name: 'ledger_id' },
    settlementId: { ...reference, name: 'settlement_id', primary: true },
    debtId: { ...reference, name: 'debt_id', primary: true },
    amount,
  },
)

export const LedgerEventEntity = table<StoredLedgerEvent>(
  'LedgerEvent',
  'ledger_events',
  {
    id,
    ledgerId: { ...reference, name: 'ledger_id' },
    subjectId: { ...reference, name: 'subject_id' },
    kind: { type: 'enum', enum: kinds },
    date: { ...date, name: 'event_date' },
    income: total,
    expense: total,
    cashIn: { ...total, name: 'cash_in' },
    cashOut: { ...total, name: 'cash_out' },
    receivableDelta: { ...total, name: 'receivable_delta' },
    payableDelta: { ...total, name: 'payable_delta' },
    count: { type: Number, name: 'record_count', default: 0 },
    categoryId: {
      type: 'varchar',
      length: 36,
      name: 'category_id',
      nullable: true,
    },
    billType: {
      type: 'enum',
      enum: ['income', 'expense'],
      name: 'bill_type',
      nullable: true,
    },
    note,
    createdBy: { ...reference, name: 'created_by', nullable: true },
    createdAt: { ...created, name: 'created_at' },
  },
)

export const LedgerDailyStatsEntity = table<StoredLedgerDailyStats>(
  'LedgerDailyStats',
  'ledger_daily_stats',
  {
    ledgerId: { ...reference, name: 'ledger_id', primary: true },
    date: { ...date, name: 'stat_date', primary: true },
    income: total,
    expense: total,
    cashIn: { ...total, name: 'cash_in' },
    cashOut: { ...total, name: 'cash_out' },
    receivableDelta: { ...total, name: 'receivable_delta' },
    payableDelta: { ...total, name: 'payable_delta' },
    count: { type: 'bigint', name: 'record_count', default: 0 },
  },
)

export const LedgerDailyCategoryEntity = table<StoredLedgerDailyCategory>(
  'LedgerDailyCategory',
  'ledger_daily_categories',
  {
    ledgerId: { ...reference, name: 'ledger_id', primary: true },
    date: { ...date, name: 'stat_date', primary: true },
    categoryId: {
      type: 'varchar',
      length: 36,
      name: 'category_id',
      primary: true,
    },
    type: { type: 'enum', enum: ['income', 'expense'] },
    amount: total,
    count: { type: 'bigint', name: 'record_count', default: 0 },
  },
)

export const ledgerDomainEntities = [
  LedgerEntity,
  LedgerMemberEntity,
  LedgerInviteEntity,
  LedgerUnlockEntity,
  LedgerOperationEntity,
  LedgerAuditEntity,
  DebtPositionEntity,
  DebtSettlementEntity,
  SettlementAllocationEntity,
  LedgerEventEntity,
  LedgerDailyStatsEntity,
  LedgerDailyCategoryEntity,
]
