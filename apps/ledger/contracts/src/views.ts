import type { Bill } from './bills.js'
import type { DebtDirection } from './ledger.js'

export interface LedgerAccountEntry {
  id: string
  subjectId: string
  date: string
  amount: string
  note: string
  createdAt: string
}
export interface LedgerTransfer {
  id: string
  fromAccountId: string
  toAccountId: string
  amount: string
  date: string
  note: string
  reversed: boolean
}
export interface LedgerAgingDebt {
  id: string
  contactId: string | null
  counterparty: string
  direction: DebtDirection
  amount: string
  settled: string
  adjusted: string
  remaining: string
  dueDate: string | null
  overdueDays: number | null
  bucket: 'not_due' | '1_30' | '31_90' | 'over_90'
}
export interface LedgerDebtAdjustment {
  id: string
  kind: 'extension' | 'waiver' | 'writeoff'
  amount: string
  date: string
  note: string
  reversed: boolean
}
export interface LedgerDebtAdjustmentRecord extends LedgerDebtAdjustment {
  debtId: string
  counterparty: string
  direction: DebtDirection
}
export interface LedgerRefund {
  id: string
  amount: string
  date: string
  note: string
  reversed: boolean
}
export interface LedgerReimbursementSummary {
  id: string
  counterparty: string
  amount: string
  received: string
  status: 'requested' | 'partial' | 'received' | 'cancelled'
}
export interface LedgerReimbursement extends LedgerReimbursementSummary {
  billId: string
  createdBy: string | null
}
export interface LedgerReimbursementReceipt {
  id: string
  amount: string
  date: string
  accountId: string | null
  note: string
  reversed: boolean
  createdBy: string | null
}
export interface LedgerBillHistory {
  id: string
  action: string
  details: unknown
  createdAt: string
  actor: string | null
}
export interface LedgerBillDetail {
  bill: Bill
  creator: string
  history: LedgerBillHistory[]
  refunds: LedgerRefund[]
  reimbursements: LedgerReimbursementSummary[]
}
export type LedgerTrashBill = Pick<
  Bill,
  'id' | 'type' | 'amount' | 'category' | 'date' | 'note' | 'createdBy'
> & { deletedAt: string | null }
export interface LedgerExport {
  filename: string
  csv: string
}
export interface LedgerAttachmentContent {
  name: string
  mimeType: string
  base64: string
}
