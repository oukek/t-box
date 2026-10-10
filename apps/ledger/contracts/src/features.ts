import type { LedgerAttachmentInput } from './attachments.js'
import type { BillCategory, BillInput } from './bills.js'
import type { DebtInput, SettlementInput } from './ledger.js'

export interface LedgerAccount {
  id: string
  name: string
  kind: 'cash' | 'bank' | 'wallet' | 'other'
  archived: boolean
  balance: string
}
export interface LedgerRefundInput extends LedgerAttachmentInput {
  billId: string
  amount: string
  date: string
  note: string
  accountId?: string | null
}
export interface LedgerTransferInput extends LedgerAttachmentInput {
  fromAccountId: string
  toAccountId: string
  amount: string
  date: string
  note: string
}
export type LedgerBatchItem =
  | { ref?: string, kind: 'bill', input: BillInput } |
  { ref?: string, kind: 'debt', input: DebtInput } |
  { ref?: string, kind: 'settlement', input: SettlementInput } |
  { ref?: string, kind: 'refund', input: LedgerRefundInput } |
  { ref?: string, kind: 'transfer', input: LedgerTransferInput }
export interface LedgerBatchResult {
  id: string
  items: {
    ref?: string
    kind: LedgerBatchItem['kind']
    result: Record<string, unknown>
  }[]
}
export interface LedgerBudget {
  id: string
  month: string
  categoryId: string | null
  amount: string
  spent: string
  remaining: string
  ratio: number
}
export interface LedgerRule {
  id: string
  name: string
  bill: BillInput
  frequency: 'week' | 'month' | 'year'
  interval: number
  startDate: string
  nextDate: string
  endDate: string | null
  mode: 'remind' | 'automatic'
  enabled: boolean
  lastError: string | null
}
export interface BillTemplate {
  id: string
  name: string
  bill: BillInput
}
export interface LedgerNotice {
  id: string
  title: string
  body: string
  read: boolean
  createdAt: string
}
export interface LedgerContact {
  id: string
  name: string
  note: string
  archived: boolean
  receivable: string
  payable: string
}
export interface LedgerAttachment {
  id: string
  resourceId: string
  name: string
  mimeType: string
  size: number
}
export interface LedgerImportRow {
  raw?: Record<string, string>
  index: number
  input: BillInput | null
  error: string | null
  duplicate: boolean
}
export interface LedgerImportDraft {
  id: string
  rows: LedgerImportRow[]
  status: 'draft' | 'committed'
  result: LedgerBatchResult | null
}
export type ManagedCategory = BillCategory & {
  active: boolean
  sortOrder: number
  pinned: boolean
}
