import type { PaymentRefund, RefundStatus } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { BillingService } from '../billing/service.js'
import type { PaymentGateway, VerifiedRefund } from './gateway.js'
import { randomUUID } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'
import { isoTime } from '@t-box/server-foundation/time'
import { decimal } from '../billing/money.js'
import { requestKey } from './service.js'

const view = (row: any): PaymentRefund => ({
  id: row.id,
  orderId: row.order_id,
  amount: decimal(BigInt(row.amount_cents) * 10000n),
  reclaimedCredit: decimal(BigInt(row.credit_micro)),
  status: row.status,
  reason: row.reason,
  error: row.error || undefined,
  createdAt: isoTime(row.created_at),
  updatedAt: isoTime(row.updated_at),
})
const pending = ['prepared', 'processing', 'uncertain', 'abnormal']
/** Full original-route refunds. Bonus credit is reclaimed together; no negative wallet or fabricated success. */
export class PaymentRefundService {
  private recovering?: Promise<void>
  constructor(
    readonly source: DataSource,
    readonly billing: BillingService,
    readonly gateway?: PaymentGateway,
  ) {}

  async list(): Promise<PaymentRefund[]> {
    return (
      await this.source.query(
        'SELECT * FROM payment_refunds ORDER BY created_at DESC,id DESC LIMIT 100',
      )
    ).map(view)
  }

  async create(
    orderId: string,
    administratorId: string,
    reason: string,
    key: string,
  ) {
    if (!this.gateway?.refund || !this.gateway.queryRefund) {
      throw new ApiError(503, 'REFUNDS_UNAVAILABLE', '渠道尚未配置退款能力')
    }
    requestKey(key)
    if (
      typeof reason !== 'string' ||
      !reason.trim() ||
      Buffer.byteLength(reason) > 80
    ) {
      throw new ApiError(400, 'REFUND_REASON', '请填写退款原因，最多 80 个字节')
    }
    const refund = await this.source.transaction(async (db) => {
      const [order] = await db.query(
        'SELECT * FROM payment_orders WHERE id=? FOR UPDATE',
        [orderId],
      )
      if (!order || order.status !== 'paid' || !order.transaction_id) {
        throw new ApiError(
          409,
          'REFUND_ORDER_INVALID',
          '仅已支付订单可申请退款',
        )
      }
      const [old] = await db.query(
        'SELECT * FROM payment_refunds WHERE order_id=? AND request_key=?',
        [orderId, key],
      )
      if (old) {
        if (old.reason !== reason.trim()) {
          throw new ApiError(
            409,
            'IDEMPOTENCY_CONFLICT',
            '重复退款请求的原因不一致',
          )
        }
        return view(old)
      }
      if (
        (
          await db.query(
            'SELECT id FROM payment_refunds WHERE order_id=? AND status<>\'closed\' LIMIT 1',
            [orderId],
          )
        ).length
      ) {
        throw new ApiError(
          409,
          'REFUND_EXISTS',
          '此订单已有退款，请核对原退款单',
        )
      }
      const wallet = await this.billing.lock(db, order.user_id)
      const credit = BigInt(order.amount_cents + order.bonus_cents) * 10000n
      if (
        BigInt(wallet.balance_micro) - BigInt(wallet.reserved_micro) <
          credit
      ) {
        throw new ApiError(
          409,
          'REFUND_BALANCE_USED',
          '可用余额不足以收回本次充值及赠送额度，请先核对已消费与预留费用',
        )
      }
      const id = randomUUID()
      await db.query(
        'UPDATE billing_wallets SET reserved_micro=reserved_micro+? WHERE user_id=?',
        [credit.toString(), order.user_id],
      )
      await db.query(
        'INSERT INTO payment_refunds(id,order_id,request_key,administrator_id,reason,amount_cents,credit_micro) VALUES(?,?,?,?,?,?,?)',
        [
          id,
          orderId,
          key,
          administratorId,
          reason.trim(),
          order.amount_cents,
          credit.toString(),
        ],
      )
      const [row] = await db.query('SELECT * FROM payment_refunds WHERE id=?', [
        id,
      ])
      return view(row)
    })
    // Receipt was committed before the network call; crash/retry retains the same merchant refund number.
    await this.process(refund.id)
    return this.get(refund.id)
  }

  async get(id: string) {
    const [row] = await this.source.query(
      'SELECT * FROM payment_refunds WHERE id=?',
      [id],
    )
    if (!row) {
      throw new ApiError(404, 'REFUND_NOT_FOUND', '退款单不存在')
    }
    return view(row)
  }

  async process(id: string) {
    if (!this.gateway?.refund || !this.gateway.queryRefund) {
      return
    }
    const owner = randomUUID()
    const claimed = await this.source.query(
      `UPDATE payment_refunds SET lease_owner=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND)
      WHERE id=? AND status IN ('prepared','processing','uncertain','abnormal') AND next_query_at<=UTC_TIMESTAMP(3)
      AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3))`,
      [owner, id],
    )
    if (!claimed.affectedRows) {
      return
    }
    try {
      const [row] = await this.source.query(
        `SELECT r.*,o.configuration_id,o.transaction_id FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id WHERE r.id=?`,
        [id],
      )
      const context = { configurationId: row.configuration_id || undefined }
      let result: VerifiedRefund | null
      const submit = () =>
        this.gateway!.refund!(
          {
            id,
            orderId: row.order_id,
            transactionId: row.transaction_id,
            amountCents: row.amount_cents,
            reason: row.reason,
          },
          context,
        )
      if (!row.submitted) {
        await this.source.query(
          'UPDATE payment_refunds SET submitted=TRUE,status=\'processing\' WHERE id=? AND lease_owner=?',
          [id, owner],
        )
        result = await submit()
      } else {
        result = await this.gateway.queryRefund(id, context)
        if (!result) {
          // Only an authenticated NOT_FOUND permits resubmission, always with
          // the original immutable merchant refund ID (WeChat deduplicates it).
          result = await submit()
        }
      }
      if (result) {
        await this.accept(result)
      } else {
        // A custom adapter may return no confirmed state; keep its credit reserved.
        await this.source.query(
          'UPDATE payment_refunds SET status=\'uncertain\',error=\'渠道尚未查到退款，请核对原退款单\' WHERE id=? AND lease_owner=?',
          [id, owner],
        )
      }
    } catch {
      await this.source.query(
        'UPDATE payment_refunds SET status=\'uncertain\',error=\'渠道结果尚未确认，余额仍预留；正在核对原退款单\' WHERE id=? AND lease_owner=? AND status NOT IN (\'succeeded\',\'closed\')',
        [id, owner],
      )
    } finally {
      await this.source.query(
        'UPDATE payment_refunds SET lease_owner=NULL,lease_until=NULL,next_query_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_owner=?',
        [id, owner],
      )
    }
  }

  async accept(event: VerifiedRefund) {
    if (
      !event ||
      !['SUCCESS', 'CLOSED', 'PROCESSING', 'ABNORMAL'].includes(event.status) ||
      event.currency !== 'CNY' ||
      !Number.isSafeInteger(event.amountCents) ||
      !Number.isSafeInteger(event.totalCents) ||
      event.amountCents <= 0 ||
      typeof event.refundId !== 'string' ||
      !/^[\w-]{1,64}$/.test(event.refundId)
    ) {
      throw new ApiError(400, 'REFUND_INVALID', '渠道退款信息无效')
    }
    await this.source.transaction(async (db) => {
      const [order] = await db.query(
        'SELECT * FROM payment_orders WHERE id=? FOR UPDATE',
        [event.orderId],
      )
      const [row] = await db.query(
        'SELECT * FROM payment_refunds WHERE id=? FOR UPDATE',
        [event.id],
      )
      if (
        !order ||
        !row ||
        row.order_id !== order.id ||
        order.transaction_id !== event.transactionId ||
        (event.configurationId !== undefined &&
          event.configurationId !== order.configuration_id) ||
          row.amount_cents !== event.amountCents ||
          order.amount_cents !== event.totalCents ||
          (row.refund_id && row.refund_id !== event.refundId)
      ) {
        throw new ApiError(
          409,
          'REFUND_MISMATCH',
          '渠道退款订单、金额或商户配置不一致',
        )
      }
      if (['succeeded', 'closed'].includes(row.status)) {
        if ((row.status === 'succeeded') !== (event.status === 'SUCCESS')) {
          throw new ApiError(
            409,
            'REFUND_CONFLICT',
            '退款终态不一致，请人工核对',
          )
        }
        return
      }
      const status: RefundStatus =
        event.status === 'SUCCESS'
          ? 'succeeded'
          : event.status === 'CLOSED'
            ? 'closed'
            : event.status === 'ABNORMAL'
              ? 'abnormal'
              : 'processing'
      if (status === 'succeeded' || status === 'closed') {
        const wallet = await this.billing.lock(db, order.user_id)
        const credit = BigInt(row.credit_micro)
        const balance =
          BigInt(wallet.balance_micro) - (status === 'succeeded' ? credit : 0n)
        const reserved = BigInt(wallet.reserved_micro) - credit
        if (balance < 0n || reserved < 0n || balance < reserved) {
          throw new ApiError(
            409,
            'REFUND_WALLET_MISMATCH',
            '退款余额预留不一致，请人工核对',
          )
        }
        await db.query(
          'UPDATE billing_wallets SET balance_micro=?,reserved_micro=? WHERE user_id=?',
          [balance.toString(), reserved.toString(), order.user_id],
        )
        if (status === 'succeeded') {
          await this.billing.entry(
            db,
            order.user_id,
            'refund',
            `refund:${row.id}`,
            -credit,
            balance,
            '充值原路退款并收回赠送额度',
            row.administrator_id,
          )
        }
      }
      await db.query(
        'UPDATE payment_refunds SET status=?,refund_id=?,error=?,succeeded_at=IF(?=\'succeeded\',?,NULL),updated_at=UTC_TIMESTAMP(3) WHERE id=?',
        [
          status,
          event.refundId,
          status === 'abnormal'
            ? '渠道退款异常，请到商户平台核对；余额仍预留'
            : null,
          status,
          event.succeededAt || new Date(),
          row.id,
        ],
      )
    })
  }

  async notify(
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    if (!this.gateway?.verifyRefund || !Buffer.isBuffer(raw)) {
      throw new ApiError(400, 'REFUND_NOTIFICATION_INVALID', '退款通知无效')
    }
    await this.accept(await this.gateway.verifyRefund(raw, headers))
  }

  recover(): Promise<void> {
    this.recovering ??= this.sweep().finally(
      () => (this.recovering = undefined),
    )
    return this.recovering
  }

  private async sweep() {
    if (!this.gateway?.queryRefund) {
      return
    }
    const rows = await this.source.query(
      'SELECT id FROM payment_refunds WHERE status IN (?) AND next_query_at<=UTC_TIMESTAMP(3) ORDER BY next_query_at LIMIT 20',
      [pending],
    )
    for (const row of rows) {
      await this.process(row.id)
    }
  }
}
