import type { PaymentRefund, RefundStatus } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { BillingService } from '../billing/service.js'
import type { StoredPaymentRefund } from '../db/records/payments-entities.js'
import type { PaymentGateway, VerifiedRefund } from './gateway.js'
import { randomUUID } from 'node:crypto'
import { isoTime } from '@t-box/server-foundation/time'
import { In, Not, Raw } from 'typeorm'
import { decimal } from '../billing/money.js'
import { quotaText } from '../billing/quota/math.js'
import {
  PaymentOrderEntity,
  PaymentRefundEntity,
} from '../db/records/payments-entities.js'
import { ErrorCode } from '../error-codes.js'
import { requestKey } from './service.js'

const view = (
  row: Pick<
    StoredPaymentRefund,
    | 'id' |
    'order_id' |
    'amount_cents' |
    'quota_atoms' |
    'status' |
    'reason' |
    'error' |
    'created_at' |
    'updated_at'
  >,
): PaymentRefund => ({
  id: row.id,
  orderId: row.order_id,
  amount: decimal(BigInt(row.amount_cents) * 10000n),
  reclaimedQuota: quotaText(BigInt(row.quota_atoms)),
  status: row.status,
  reason: row.reason,
  error: row.error || undefined,
  createdAt: isoTime(row.created_at),
  updatedAt: isoTime(row.updated_at),
})
const pending: RefundStatus[] = [
  'prepared',
  'processing',
  'uncertain',
  'abnormal',
]
/** Refund only unused rights from the original purchase lot, including bonus rights proportionally. */
export class PaymentRefundService {
  private recovering?: Promise<void>
  constructor(
    readonly source: DataSource,
    readonly billing: BillingService,
    readonly gateway?: PaymentGateway,
  ) {}

  async list(): Promise<PaymentRefund[]> {
    return (
      await this.source.getRepository(PaymentRefundEntity).find({
        select: {
          id: true,
          order_id: true,
          amount_cents: true,
          quota_atoms: true,
          status: true,
          reason: true,
          error: true,
          created_at: true,
          updated_at: true,
        },
        order: { created_at: 'DESC', id: 'DESC' },
        take: 100,
      })
    ).map(view)
  }

  async forUser(userId: string): Promise<PaymentRefund[]> {
    const rows = await this.source
      .getRepository(PaymentRefundEntity)
      .createQueryBuilder('r')
      .select([
        'r.id',
        'r.order_id',
        'r.amount_cents',
        'r.quota_atoms',
        'r.status',
        'r.reason',
        'r.error',
        'r.created_at',
        'r.updated_at',
      ])
      .innerJoin('payment_orders', 'o', 'o.id=r.order_id')
      .where('o.user_id=:userId', { userId })
      .orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .take(100)
      .getMany()
    return rows.map(view)
  }

  async create(
    orderId: string,
    administratorId: string,
    reason: string,
    key: string,
  ) {
    if (!this.gateway?.refund || !this.gateway.queryRefund) {
      throw ErrorCode.REFUNDS_UNAVAILABLE()
    }
    requestKey(key)
    if (
      typeof reason !== 'string' ||
      !reason.trim() ||
      Buffer.byteLength(reason) > 80
    ) {
      throw ErrorCode.REFUND_REASON()
    }
    const refund = await this.source.transaction(async (db) => {
      const order = await db.getRepository(PaymentOrderEntity).findOne({
        select: {
          id: true,
          user_id: true,
          request_key: true,
          channel: true,
          amount_cents: true,
          currency: true,
          status: true,
          transaction_id: true,
          created_at: true,
          expires_at: true,
          paid_at: true,
          configuration_id: true,
          payment_mode: true,
          next_query_at: true,
          package_snapshot: true,
        },
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!order || order.status !== 'paid' || !order.transaction_id) {
        throw ErrorCode.REFUND_ORDER_INVALID()
      }
      const old = await db.getRepository(PaymentRefundEntity).findOne({
        select: {
          id: true,
          order_id: true,
          request_key: true,
          administrator_id: true,
          reason: true,
          amount_cents: true,
          quota_atoms: true,
          status: true,
          refund_id: true,
          submitted: true,
          error: true,
          lease_owner: true,
          lease_until: true,
          next_query_at: true,
          created_at: true,
          updated_at: true,
          succeeded_at: true,
        },
        where: { order_id: orderId, request_key: key },
      })
      if (old) {
        if (old.reason !== reason.trim()) {
          throw ErrorCode.IDEMPOTENCY_CONFLICT('重复退款请求的原因不一致')
        }
        return view(old)
      }
      if (
        (
          await db.getRepository(PaymentRefundEntity).find({
            select: { id: true },
            where: { order_id: orderId, status: Not('closed') },
            take: 1,
          })
        ).length
      ) {
        throw ErrorCode.REFUND_EXISTS()
      }
      const id = randomUUID()
      const held = await this.billing.inventory.refundReserve(
        db,
        order.user_id,
        order.id,
        `refund:${id}`,
      )
      const refundCents = Number(
        (BigInt(order.amount_cents) * held.amount) / held.total,
      )
      if (refundCents < 1) {
        throw ErrorCode.REFUND_BALANCE_USED('未使用权益不足以退回一分钱')
      }
      await db.getRepository(PaymentRefundEntity).insert({
        id,
        order_id: orderId,
        request_key: key,
        administrator_id: administratorId,
        reason: reason.trim(),
        amount_cents: refundCents,
        quota_atoms: held.amount.toString(),
      })
      const row = await db.getRepository(PaymentRefundEntity).findOne({
        select: {
          id: true,
          order_id: true,
          request_key: true,
          administrator_id: true,
          reason: true,
          amount_cents: true,
          quota_atoms: true,
          status: true,
          refund_id: true,
          submitted: true,
          error: true,
          lease_owner: true,
          lease_until: true,
          next_query_at: true,
          created_at: true,
          updated_at: true,
          succeeded_at: true,
        },
        where: { id },
      })
      if (!row) {
        throw ErrorCode.REFUND_NOT_FOUND()
      }
      return view(row)
    })
    // Receipt was committed before the network call; crash/retry retains the same merchant refund number.
    await this.process(refund.id)
    return this.get(refund.id)
  }

  async get(id: string) {
    const row = await this.source.getRepository(PaymentRefundEntity).findOne({
      select: {
        id: true,
        order_id: true,
        request_key: true,
        administrator_id: true,
        reason: true,
        amount_cents: true,
        quota_atoms: true,
        status: true,
        refund_id: true,
        submitted: true,
        error: true,
        lease_owner: true,
        lease_until: true,
        next_query_at: true,
        created_at: true,
        updated_at: true,
        succeeded_at: true,
      },
      where: { id },
    })
    if (!row) {
      throw ErrorCode.REFUND_NOT_FOUND()
    }
    return view(row)
  }

  async process(id: string) {
    if (!this.gateway?.refund || !this.gateway.queryRefund) {
      return
    }
    const owner = randomUUID()
    const claimed = await this.source
      .createQueryBuilder()
      .update('payment_refunds')
      .set({
        lease_owner: owner,
        lease_until: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND)',
      })
      .updateEntity(false)
      .where(
        'id=:p1 AND status IN (\'prepared\',\'processing\',\'uncertain\',\'abnormal\') AND next_query_at<=UTC_TIMESTAMP(3)\n      AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3))',
      )
      .setParameters({ p1: id })
      .execute()
    if (!claimed.affected) {
      return
    }
    try {
      const [row] = await this.source
        .createQueryBuilder()
        .select(
          'r.id,r.order_id,r.reason,r.amount_cents,r.submitted,o.amount_cents AS total_cents,o.configuration_id,o.transaction_id',
        )
        .from('payment_refunds', 'r')
        .innerJoin('payment_orders', 'o', 'o.id=r.order_id')
        .where('r.id=:p0')
        .setParameters({ p0: id })
        .getRawMany()
      const context = { configurationId: row.configuration_id || undefined }
      let result: VerifiedRefund | null
      const submit = () =>
        this.gateway!.refund!(
          {
            id,
            orderId: row.order_id,
            transactionId: row.transaction_id,
            amountCents: row.amount_cents,
            totalCents: row.total_cents,
            reason: row.reason,
          },
          context,
        )
      if (!row.submitted) {
        await this.source
          .getRepository(PaymentRefundEntity)
          .update(
            { id, lease_owner: owner },
            { submitted: true, status: 'processing' },
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
        await this.source
          .getRepository(PaymentRefundEntity)
          .update(
            { id, lease_owner: owner },
            { status: 'uncertain', error: '渠道尚未查到退款，请核对原退款单' },
          )
      }
    } catch {
      await this.source.getRepository(PaymentRefundEntity).update(
        {
          id,
          lease_owner: owner,
          status: Not(In(['succeeded', 'closed'])),
        },
        {
          status: 'uncertain',
          error: '渠道结果尚未确认，余额仍预留；正在核对原退款单',
        },
      )
    } finally {
      await this.source.getRepository(PaymentRefundEntity).update(
        { id, lease_owner: owner },
        {
          lease_owner: null,
          lease_until: null,
          next_query_at: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND)',
          updated_at: () => 'UTC_TIMESTAMP(3)',
        },
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
      throw ErrorCode.REFUND_INVALID()
    }
    await this.source.transaction(async (db) => {
      const order = await db.getRepository(PaymentOrderEntity).findOne({
        select: {
          id: true,
          user_id: true,
          request_key: true,
          channel: true,
          amount_cents: true,
          currency: true,
          status: true,
          transaction_id: true,
          created_at: true,
          expires_at: true,
          paid_at: true,
          configuration_id: true,
          payment_mode: true,
          next_query_at: true,
          package_snapshot: true,
        },
        where: { id: event.orderId },
        lock: { mode: 'pessimistic_write' },
      })
      const row = await db.getRepository(PaymentRefundEntity).findOne({
        select: {
          id: true,
          order_id: true,
          request_key: true,
          administrator_id: true,
          reason: true,
          amount_cents: true,
          quota_atoms: true,
          status: true,
          refund_id: true,
          submitted: true,
          error: true,
          lease_owner: true,
          lease_until: true,
          next_query_at: true,
          created_at: true,
          updated_at: true,
          succeeded_at: true,
        },
        where: { id: event.id },
        lock: { mode: 'pessimistic_write' },
      })
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
        throw ErrorCode.REFUND_MISMATCH()
      }
      if (['succeeded', 'closed'].includes(row.status)) {
        if ((row.status === 'succeeded') !== (event.status === 'SUCCESS')) {
          throw ErrorCode.REFUND_CONFLICT()
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
        await this.billing.lock(db, order.user_id)
        await this.billing.inventory.capture(
          db,
          order.user_id,
          `refund:${row.id}`,
          status === 'succeeded' ? BigInt(row.quota_atoms) : 0n,
          true,
        )
      }

      await db
        .createQueryBuilder()
        .update('payment_refunds')
        .set({
          status,
          refund_id: event.refundId,
          error:
            status === 'abnormal'
              ? '渠道退款异常，请到商户平台核对；余额仍预留'
              : null,
          succeeded_at: () => 'IF(:p3=\'succeeded\',:p4,NULL)',
          updated_at: () => 'UTC_TIMESTAMP(3)',
        })
        .updateEntity(false)
        .where('id=:p5')
        .setParameters({
          p3: status,
          p4: event.succeededAt || new Date(),
          p5: row.id,
        })
        .execute()
    })
  }

  async notify(
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    if (!this.gateway?.verifyRefund || !Buffer.isBuffer(raw)) {
      throw ErrorCode.REFUND_NOTIFICATION_INVALID()
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
    const rows = await this.source.getRepository(PaymentRefundEntity).find({
      select: { id: true },
      where: {
        status: In(pending),
        next_query_at: Raw((column) => `${column} <= UTC_TIMESTAMP(3)`),
      },
      order: { next_query_at: 'ASC' },
      take: 20,
    })
    for (const row of rows) {
      await this.process(row.id)
    }
  }
}
