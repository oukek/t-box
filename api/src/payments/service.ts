import type {
  PaymentCapabilities,
  PaymentOrder,
  WechatPaymentMode,
} from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { BillingService } from '../billing/service.js'
import type { StoredPaymentOrder } from '../db/records/payments-entities.js'
import type { PaymentGateway, VerifiedPayment } from './gateway.js'
import { randomUUID } from 'node:crypto'
import { isoTime } from '@t-box/server-foundation/time'
import { Raw } from 'typeorm'
import { decimal, money } from '../billing/money.js'
import { PaymentOrderEntity } from '../db/records/payments-entities.js'
import { ErrorCode } from '../error-codes.js'
import { RechargeSettingsService } from './recharge.js'

type OrderRow = Pick<
  StoredPaymentOrder,
  | 'id' |
  'amount_cents' |
  'bonus_cents' |
  'currency' |
  'status' |
  'created_at' |
  'expires_at' |
  'paid_at'
>
// Public order views do not need gateway IDs, idempotency keys or polling leases.
const orderViewFields = {
  id: true,
  amount_cents: true,
  bonus_cents: true,
  currency: true,
  status: true,
  created_at: true,
  expires_at: true,
  paid_at: true,
} as const
const view = (r: OrderRow): PaymentOrder => ({
  id: r.id,
  amount: decimal(BigInt(r.amount_cents) * 10_000n),
  bonusAmount: decimal(BigInt(r.bonus_cents ?? 0) * 10_000n),
  creditedAmount: decimal(
    BigInt(r.amount_cents + (r.bonus_cents ?? 0)) * 10_000n,
  ),
  currency: r.currency,
  status: r.status,
  createdAt: isoTime(r.created_at),
  expiresAt: isoTime(r.expires_at),
  paidAt: r.paid_at ? isoTime(r.paid_at) : null,
})
export function requestKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{16,64}$/.test(value)) {
    throw ErrorCode.IDEMPOTENCY_REQUIRED()
  }
  return value
}
export class PaymentService {
  constructor(
    readonly source: DataSource,
    readonly billing: BillingService,
    private readonly gateway?: PaymentGateway,
    private readonly bonusPolicy?: Pick<RechargeSettingsService, 'bonusCents'>,
  ) {}

  async capabilities(): Promise<PaymentCapabilities> {
    return this.gateway?.capabilities
      ? this.gateway.capabilities()
      : { enabled: !!this.gateway, channel: 'wechat' }
  }

  private adapter() {
    if (!this.gateway) {
      throw ErrorCode.PAYMENT_NOT_CONFIGURED()
    }
    return this.gateway
  }

  async create(
    userId: string,
    amount: unknown,
    key: string,
  ): Promise<PaymentOrder> {
    const gateway = this.adapter()
    const configurationId = await gateway.configurationId?.()
    const micros = money(amount)
    if (
      micros < 1_000_000n ||
      micros > 10_000n * 1_000_000n ||
      micros % 10_000n
    ) {
      throw ErrorCode.INVALID_RECHARGE()
    }
    requestKey(key)
    return this.source.transaction(async (db) => {
      // Serialize order creation per wallet and bound pending orders per user.
      await this.billing.lock(db, userId)
      const old = await db.getRepository(PaymentOrderEntity).findOne({
        select: orderViewFields,
        where: { user_id: userId, request_key: key },
      })
      if (old) {
        if (old.amount_cents !== Number(micros / 10_000n)) {
          throw ErrorCode.IDEMPOTENCY_CONFLICT('重复请求金额不一致')
        }
        return view(old)
      }
      const pending = await db.getRepository(PaymentOrderEntity).count({
        where: {
          user_id: userId,
          status: 'pending',
          expires_at: Raw((column) => `${column} > UTC_TIMESTAMP(3)`),
        },
      })
      if (pending >= 10) {
        throw ErrorCode.ORDER_LIMIT()
      }
      const bonusCents = await (
        this.bonusPolicy ?? new RechargeSettingsService(db)
      ).bonusCents(Number(micros / 10_000n))
      const id = randomUUID()
      await db.getRepository(PaymentOrderEntity).insert({
        id,
        user_id: userId,
        request_key: key,
        amount_cents: Number(micros / 10_000n),
        configuration_id: configurationId ?? null,
        bonus_cents: bonusCents,
        expires_at: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE)',
      })
      const row = await db.getRepository(PaymentOrderEntity).findOne({
        select: orderViewFields,
        where: { id },
      })
      if (!row) {
        throw ErrorCode.ORDER_NOT_FOUND()
      }
      return view(row)
    })
  }

  async get(userId: string, id: string) {
    const row = await this.source.getRepository(PaymentOrderEntity).findOne({
      select: orderViewFields,
      where: { id, user_id: userId },
    })
    if (!row) {
      throw ErrorCode.ORDER_NOT_FOUND()
    }
    return view(row)
  }

  async list(userId?: string): Promise<PaymentOrder[]> {
    const rows = await this.source.getRepository(PaymentOrderEntity).find({
      select: orderViewFields,
      ...(userId ? { where: { user_id: userId } } : {}),
      order: { created_at: 'DESC', id: 'DESC' },
      take: 100,
    })
    return rows.map(view)
  }

  async adminList() {
    const rows = await this.source
      .createQueryBuilder()
      .select(
        'o.id,o.user_id,o.amount_cents,o.bonus_cents,o.currency,o.status,o.created_at,o.expires_at,o.paid_at,u.username,u.nickname',
      )
      .from('payment_orders', 'o')
      .innerJoin('app_users', 'u', 'u.id=o.user_id')
      .orderBy('o.created_at', 'DESC')
      .addOrderBy('o.id', 'DESC')
      .limit(100)
      .getRawMany()
    return rows.map(
      (
        r: OrderRow & { user_id: string, username: string, nickname: string },
      ) => ({
        ...view(r),
        userId: r.user_id,
        username: r.username,
        nickname: r.nickname,
      }),
    )
  }

  async intent(
    userId: string,
    id: string,
    mode: WechatPaymentMode = 'native',
    clientIp?: string,
  ) {
    const gateway = this.adapter()
    const order = await this.get(userId, id)
    if (
      order.status !== 'pending' ||
      Date.parse(order.expiresAt) <= Date.now()
    ) {
      throw ErrorCode.ORDER_NOT_PAYABLE()
    }
    // Adapter must use this local id as merchant order number; repeat creation
    // must recover the same upstream order after an unknown network outcome.
    if (!['native', 'h5', 'jsapi', 'app'].includes(mode)) {
      throw ErrorCode.INVALID_PAYMENT_MODE()
    }
    const context = await this.source.transaction(async (db) => {
      const row = await db.getRepository(PaymentOrderEntity).findOne({
        select: { id: true, configuration_id: true, payment_mode: true },
        where: { id, user_id: userId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!row) {
        throw ErrorCode.ORDER_NOT_FOUND()
      }
      if (row.payment_mode && row.payment_mode !== mode) {
        throw ErrorCode.PAYMENT_MODE_LOCKED()
      }
      await db
        .getRepository(PaymentOrderEntity)
        .update({ id }, { payment_mode: mode })
      return {
        configurationId: row.configuration_id ?? undefined,
        mode,
        clientIp,
        userId,
      }
    })
    return gateway.create(order, Number(money(order.amount) / 10_000n), context)
  }

  async close(userId: string, id: string) {
    const order = await this.get(userId, id)
    if (order.status === 'paid') {
      throw ErrorCode.ORDER_PAID()
    }
    if (order.status === 'closed') {
      return
    }
    await this.adapter().close(id, await this.context(id))
    await this.source
      .getRepository(PaymentOrderEntity)
      .update({ id, user_id: userId, status: 'pending' }, { status: 'closed' })
    return this.get(userId, id)
  }

  async notify(
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const adapter = this.adapter()
    if (!Buffer.isBuffer(raw)) {
      throw ErrorCode.PAYMENT_BODY_INVALID()
    }
    const event = await adapter.verify(raw, headers)
    await this.accept(event)
  }

  private async context(id: string) {
    const row = await this.source.getRepository(PaymentOrderEntity).findOne({
      select: { id: true, configuration_id: true, payment_mode: true },
      where: { id },
    })
    if (!row) {
      throw ErrorCode.ORDER_NOT_FOUND()
    }
    return {
      configurationId: row.configuration_id ?? undefined,
      mode: (row.payment_mode ?? 'native') as WechatPaymentMode,
    }
  }

  async refresh(userId: string, id: string) {
    const order = await this.get(userId, id)
    if (order.status !== 'paid') {
      const query = await this.source.transaction(async (db) => {
        const [row] = await db
          .createQueryBuilder()
          .select('next_query_at>UTC_TIMESTAMP(3) AS limited')
          .from('payment_orders', 'payment_orders')
          .where('id=:p0 AND user_id=:p1')
          .setLock('pessimistic_write')
          .setParameters({ p0: id, p1: userId })
          .getRawMany()
        if (row.limited) {
          return false
        }
        await db.getRepository(PaymentOrderEntity).update(
          { id },
          {
            next_query_at: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 SECOND)',
          },
        )
        return true
      })
      if (query) {
        await this.reconcile(id)
      }
    }
    return this.get(userId, id)
  }

  async reconcile(id: string) {
    const event = await this.adapter().query(id, await this.context(id))
    if (event) {
      if (event.orderId !== id) {
        throw ErrorCode.PAYMENT_MISMATCH()
      }
      await this.accept(event)
    }
    return { paid: !!event }
  }

  /** Only gateway-verified events enter this boundary; there is no HTTP mark-paid API. */
  private async accept(event: VerifiedPayment) {
    if (
      !event ||
      typeof event.orderId !== 'string' ||
      typeof event.transactionId !== 'string' ||
      !(event.paidAt instanceof Date) ||
      !Number.isSafeInteger(event.amountCents) ||
      event.amountCents <= 0 ||
      event.currency !== 'CNY' ||
      !/^[\w-]{1,100}$/.test(event.transactionId) ||
      !Number.isFinite(event.paidAt.getTime()) ||
      event.paidAt.getTime() > Date.now() + 60_000
    ) {
      throw ErrorCode.PAYMENT_INVALID()
    }
    await this.source
      .transaction(async (db) => {
        const row = await db.getRepository(PaymentOrderEntity).findOne({
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
            bonus_cents: true,
          },
          where: { id: event.orderId },
          lock: { mode: 'pessimistic_write' },
        })
        if (
          !row ||
          (event.configurationId !== undefined &&
            row.configuration_id !== event.configurationId) ||
            row.amount_cents !== event.amountCents ||
            row.currency !== event.currency ||
          // Channels commonly report whole seconds; local rows have milliseconds.
            event.paidAt.getTime() + 1000 < Date.parse(isoTime(row.created_at)) ||
            event.paidAt.getTime() > Date.parse(isoTime(row.expires_at))
        ) {
          throw ErrorCode.PAYMENT_MISMATCH('订单金额、币种或支付时间不一致')
        }
        if (row.status === 'paid') {
          if (row.transaction_id !== event.transactionId) {
            throw ErrorCode.PAYMENT_CONFLICT()
          }
          return
        }
        // A delayed, verified successful payment can arrive after local close.
        // Honor real funds; cancel/expiry cannot erase a valid payment.
        await db.getRepository(PaymentOrderEntity).update(
          { id: row.id },
          {
            status: 'paid',
            transaction_id: event.transactionId,
            paid_at: event.paidAt.toISOString().replace('T', ' ').slice(0, -1),
          },
        )
        await this.billing.credit(
          db,
          row.user_id,
          BigInt(event.amountCents) * 10_000n,
          `payment:${row.id}`,
          'recharge',
        )
        if (row.bonus_cents > 0) {
          await this.billing.credit(
            db,
            row.user_id,
            BigInt(row.bonus_cents) * 10_000n,
            `payment-bonus:${row.id}`,
            'grant',
            '充值满赠',
          )
        }
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
          throw ErrorCode.PAYMENT_CONFLICT(
            '该支付流水已关联订单，请核对支付记录',
          )
        }
        throw error
      })
  }
}
