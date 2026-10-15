export interface ReconciliationDifference {
  kind: 'remote_only' | 'local_only' | 'amount_mismatch' | 'state_mismatch'
  orderId: string
  refundId?: string
}
export interface DailyReconciliation {
  id: string
  day: string
  status: 'pending' | 'running' | 'completed' | 'differences' | 'failed'
  rows: number
  differences: number
  details: ReconciliationDifference[]
  error?: string
  updatedAt: string
}
