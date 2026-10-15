import type {
  PaymentCapabilities,
  PaymentIntent,
  PaymentOrder,
  WechatPaymentMode,
} from '@t-box/shared'

export interface PaymentContext {
  configurationId?: string
  mode?: WechatPaymentMode
  clientIp?: string
  userId?: string
}
export interface VerifiedPayment {
  configurationId?: string
  orderId: string
  transactionId: string
  amountCents: number
  currency: 'CNY'
  paidAt: Date
}
export interface RefundRequest {
  id: string
  orderId: string
  transactionId: string
  amountCents: number
  reason: string
}
export interface VerifiedRefund {
  succeededAt?: Date
  id: string
  orderId: string
  configurationId?: string
  transactionId: string
  refundId: string
  amountCents: number
  totalCents: number
  currency: 'CNY'
  status: 'SUCCESS' | 'PROCESSING' | 'CLOSED' | 'ABNORMAL'
}
/**
 * Trusted server adapter. verify must authenticate the raw body, validate merchant/
 * app identity and SUCCESS state, decrypt payload and reject replayed invalid data.
 * query must use authenticated merchant API, never a client-reported payment state.
 */
export interface PaymentGateway {
  statement?(day: string, context: PaymentContext): Promise<MerchantStatement>
  refund?(input: RefundRequest, context: PaymentContext): Promise<VerifiedRefund>
  queryRefund?(id: string, context: PaymentContext): Promise<VerifiedRefund | null>
  verifyRefund?(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<VerifiedRefund>
  readonly channel: 'wechat'
  capabilities?(): Promise<PaymentCapabilities>
  configurationId?(): Promise<string>
  create(
    order: PaymentOrder,
    amountCents: number,
    context?: PaymentContext,
  ): Promise<PaymentIntent>
  close(orderId: string, context?: PaymentContext): Promise<void>
  query(
    orderId: string,
    context?: PaymentContext,
  ): Promise<VerifiedPayment | null>
  verify(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<VerifiedPayment>
}
export interface MerchantStatement {
  day: string
  merchantId: string
  sha1: string
  rows: { kind: 'payment' | 'refund' | 'reversal', orderId: string, transactionId: string, refundId?: string, merchantRefundId?: string, amountCents: number }[]
}
