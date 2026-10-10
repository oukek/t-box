export const ledgerRecordKinds = [
  'bill',
  'debt',
  'settlement',
  'refund',
  'transfer',
  'reimbursement',
  'reimbursement-receipt',
  'debt-adjustment',
  'account-entry',
] as const
export type LedgerRecordKind = (typeof ledgerRecordKinds)[number]
export interface LedgerAttachmentInput {
  /** Uploaded resource IDs; added atomically with the financial record. */
  attachmentResourceIds?: string[]
}
export const LEDGER_ATTACHMENT_LIMIT = 20
export const LEDGER_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
