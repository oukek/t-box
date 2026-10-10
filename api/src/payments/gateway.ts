import type {
  PaymentIntent,
  PaymentOrder,
  PaymentCapabilities,
  WechatPaymentMode,
} from "@t-box/shared";
export interface PaymentContext {
  configurationId?: string;
  mode?: WechatPaymentMode;
  clientIp?: string;
  userId?: string;
}
export interface VerifiedPayment {
  configurationId?: string;
  orderId: string;
  transactionId: string;
  amountCents: number;
  currency: "CNY";
  paidAt: Date;
}
/** Trusted server adapter. verify must authenticate the raw body, validate merchant/
 * app identity and SUCCESS state, decrypt payload and reject replayed invalid data.
 * query must use authenticated merchant API, never a client-reported payment state. */
export interface PaymentGateway {
  readonly channel: "wechat";
  capabilities?(): Promise<PaymentCapabilities>;
  configurationId?(): Promise<string>;
  create(
    order: PaymentOrder,
    amountCents: number,
    context?: PaymentContext,
  ): Promise<PaymentIntent>;
  close(orderId: string, context?: PaymentContext): Promise<void>;
  query(
    orderId: string,
    context?: PaymentContext,
  ): Promise<VerifiedPayment | null>;
  verify(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<VerifiedPayment>;
}
