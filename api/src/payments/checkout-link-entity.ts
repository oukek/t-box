import { EntitySchema } from 'typeorm'

export interface CheckoutLinkRow {
  orderId: string
  tokenHash: string
  payerUserId: string | null
  scanFlowId: string | null
  scanExpiresAt: Date | null
  stage: 'waiting' | 'scanned' | 'confirming' | 'paying' | 'cancelled'
  expiresAt: Date
}
export const CheckoutLinkEntity = new EntitySchema<CheckoutLinkRow>({
  name: 'WechatCheckoutLink',
  tableName: 'wechat_checkout_links',
  columns: {
    orderId: { type: 'char', length: 36, primary: true, name: 'order_id' },
    tokenHash: { type: 'char', length: 64, name: 'token_hash', unique: true, select: false },
    payerUserId: { type: 'char', length: 36, name: 'payer_user_id', nullable: true },
    scanFlowId: { type: 'char', length: 36, name: 'scan_flow_id', nullable: true },
    scanExpiresAt: { type: 'datetime', precision: 3, name: 'scan_expires_at', nullable: true },
    stage: { type: 'enum', enum: ['waiting', 'scanned', 'confirming', 'paying', 'cancelled'], default: 'waiting' },
    expiresAt: { type: 'datetime', precision: 3, name: 'expires_at' },
  },
})
export const checkoutLinkExtension = {
  id: '2026-10-28-wechat-checkout-links',
  tables: [`CREATE TABLE wechat_checkout_links (
    order_id char(36) NOT NULL PRIMARY KEY,
    token_hash char(64) NOT NULL,
    payer_user_id char(36) DEFAULT NULL,
    scan_flow_id char(36) DEFAULT NULL,
    scan_expires_at datetime(3) DEFAULT NULL,
    stage enum('waiting','scanned','confirming','paying','cancelled') NOT NULL DEFAULT 'waiting',
    expires_at datetime(3) NOT NULL,
    UNIQUE KEY wechat_checkout_token(token_hash),
    KEY wechat_checkout_expiry(expires_at),
    CONSTRAINT wechat_checkout_order_fk FOREIGN KEY(order_id) REFERENCES payment_orders(id) ON DELETE CASCADE,
    CONSTRAINT wechat_checkout_payer_fk FOREIGN KEY(payer_user_id) REFERENCES app_users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
}
