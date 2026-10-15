export type RefundStatus =
  'prepared' | 'processing' | 'uncertain' | 'abnormal' | 'succeeded' | 'closed'
export interface PaymentRefund {
  id: string
  orderId: string
  amount: string
  reclaimedCredit: string
  status: RefundStatus
  reason: string
  error?: string
  createdAt: string
  updatedAt: string
}
