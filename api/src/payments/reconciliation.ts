import type {
  DailyReconciliation,
  ReconciliationDifference,
} from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type {
  StoredPaymentOrder,
  StoredPaymentReconciliation,
  StoredPaymentRefund,
} from '../db/records/payments-entities.js'
import type { PaymentConfiguration } from './configuration.js'
import type { MerchantStatement, PaymentGateway } from './gateway.js'
import { createHash, randomUUID } from 'node:crypto'
import { isoTime } from '@t-box/server-foundation/time'
import { parseDate } from '@t-box/server-foundation/validation'
import { In } from 'typeorm'
import {
  PaymentReconciliationEntity,
  PaymentRefundEntity,
} from '../db/records/payments-entities.js'
import { ErrorCode } from '../error-codes.js'

type ReconciliationOrder = Pick<
  StoredPaymentOrder,
  'id' | 'amount_cents' | 'status' | 'transaction_id'
>
type ReconciliationRefund = Pick<
  StoredPaymentRefund,
  'id' | 'order_id' | 'amount_cents' | 'status' | 'refund_id'
>
const dayAt = (milliseconds: number) =>
  new Date(milliseconds + 8 * 3600000).toISOString().slice(0, 10)
const localId = (value: string) =>
  /^[a-f0-9]{32}$/i.test(value)
    ? `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`.toLowerCase()
    : value
const view = (
  row: Pick<
    StoredPaymentReconciliation,
    | 'id' |
    'day' |
    'status' |
    'row_count' |
    'difference_count' |
    'details_json' |
    'error' |
    'updated_at'
  > | null,
): DailyReconciliation => {
  if (!row) {
    throw ErrorCode.RECONCILIATION_UNAVAILABLE()
  }
  return {
    id: row.id,
    day: String(row.day).slice(0, 10),
    status: row.status,
    rows: Number(row.row_count),
    differences: Number(row.difference_count),
    details:
      typeof row.details_json === 'string'
        ? JSON.parse(row.details_json)
        : row.details_json || [],
    error: row.error || undefined,
    updatedAt: isoTime(row.updated_at),
  }
}

/** Merchant statements identify differences; they never fabricate wallet/payment mutations. */
export class PaymentReconciliationService {
  private recovering?: Promise<void>
  private nextSweep = 0
  constructor(
    readonly source: DataSource,
    readonly gateway?: PaymentGateway,
    readonly configuration?: PaymentConfiguration,
  ) {}

  async list(): Promise<DailyReconciliation[]> {
    return (
      await this.source.getRepository(PaymentReconciliationEntity).find({
        select: {
          id: true,
          day: true,
          merchant_hash: true,
          configuration_id: true,
          status: true,
          row_count: true,
          difference_count: true,
          details_json: true,
          statement_sha1: true,
          error: true,
          attempts: true,
          lease_owner: true,
          lease_until: true,
          next_attempt_at: true,
          updated_at: true,
        },
        order: { day: 'DESC', updated_at: 'DESC' },
        take: 100,
      })
    ).map(view)
  }

  private checkDay(day: string) {
    parseDate(day)
    const today = dayAt(Date.now())
    if (day >= today || day < dayAt(Date.now() - 90 * 86400000)) {
      throw ErrorCode.STATEMENT_DATE()
    }
  }

  private async enqueue(
    day: string,
    config: { id: string, merchantId: string },
  ) {
    const hash = createHash('sha256').update(config.merchantId).digest('hex')
    await this.source
      .createQueryBuilder()
      .insert()
      .into('payment_reconciliations')
      .values({
        id: randomUUID(),
        day: () => ':p1',
        merchant_hash: hash,
        configuration_id: config.id,
      })
      .updateEntity(false)
      .orIgnore()
      .setParameters({ p1: day })
      .execute()
    const row = await this.source
      .getRepository(PaymentReconciliationEntity)
      .findOne({
        select: { id: true },
        where: { merchant_hash: hash, day },
      })
    if (!row) {
      throw ErrorCode.RECONCILIATION_UNAVAILABLE()
    }
    return row.id
  }

  async run(day: string) {
    this.checkDay(day)
    const config = await this.configuration?.runtime()
    if (!config || !this.gateway?.statement) {
      throw ErrorCode.RECONCILIATION_UNAVAILABLE()
    }
    const id = await this.enqueue(day, config)
    await this.process(id, true)
    const row = await this.source
      .getRepository(PaymentReconciliationEntity)
      .findOne({
        select: {
          id: true,
          day: true,
          merchant_hash: true,
          configuration_id: true,
          status: true,
          row_count: true,
          difference_count: true,
          details_json: true,
          statement_sha1: true,
          error: true,
          attempts: true,
          lease_owner: true,
          lease_until: true,
          next_attempt_at: true,
          updated_at: true,
        },
        where: { id },
      })
    return view(row)
  }

  async compare(
    statement: MerchantStatement,
    configurationId: string,
  ): Promise<ReconciliationDifference[]> {
    const start = new Date(`${statement.day}T00:00:00+08:00`)
    const end = new Date(start.getTime() + 86400000)
    const orders = new Map<string, ReconciliationOrder>()
    const refunds = new Map<string, ReconciliationRefund>()
    const dayOrders = await this.source
      .createQueryBuilder()
      .select('o.id,o.amount_cents,o.status,o.transaction_id')
      .from('payment_orders', 'o')
      .innerJoin('payment_configurations', 'c', 'c.id=o.configuration_id')
      .where(
        'JSON_UNQUOTE(JSON_EXTRACT(c.public_json,\'$.merchantId\'))=:p0 AND o.status=\'paid\' AND o.paid_at>=:p1 AND o.paid_at<:p2',
      )
      .setParameters({ p0: statement.merchantId, p1: start, p2: end })
      .getRawMany<ReconciliationOrder>()
    const dayRefunds = await this.source
      .createQueryBuilder()
      .select('r.id,r.order_id,r.amount_cents,r.status,r.refund_id')
      .from('payment_refunds', 'r')
      .innerJoin('payment_orders', 'o', 'o.id=r.order_id')
      .innerJoin('payment_configurations', 'c', 'c.id=o.configuration_id')
      .where(
        'JSON_UNQUOTE(JSON_EXTRACT(c.public_json,\'$.merchantId\'))=:p0 AND r.status=\'succeeded\' AND r.succeeded_at>=:p1 AND r.succeeded_at<:p2',
      )
      .setParameters({ p0: statement.merchantId, p1: start, p2: end })
      .getRawMany<ReconciliationRefund>()
    for (const order of dayOrders) {
      orders.set(order.id, order)
    }
    for (const refund of dayRefunds) {
      refunds.set(refund.id, refund)
    }
    const ids = [
      ...new Set(statement.rows.map((row) => localId(row.orderId))),
    ].filter((id) => /^[a-f0-9-]{36}$/i.test(id))
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500)
      const existing = await this.source
        .createQueryBuilder()
        .select('o.id,o.amount_cents,o.status,o.transaction_id')
        .from('payment_orders', 'o')
        .innerJoin('payment_configurations', 'c', 'c.id=o.configuration_id')
        .where(
          'o.id IN (:p0) AND JSON_UNQUOTE(JSON_EXTRACT(c.public_json,\'$.merchantId\'))=:p1',
        )
        .setParameters({ p0: batch, p1: statement.merchantId })
        .getRawMany<ReconciliationOrder>()
      for (const order of existing) {
        orders.set(order.id, order)
      }
      const known = await this.source.getRepository(PaymentRefundEntity).find({
        select: {
          id: true,
          order_id: true,
          amount_cents: true,
          status: true,
          refund_id: true,
        },
        where: { order_id: In(batch) },
      })
      for (const refund of known) {
        refunds.set(refund.id, refund)
      }
    }
    const differences: ReconciliationDifference[] = []
    const seenOrders = new Set<string>()
    const seenRefunds = new Set<string>()
    for (const row of statement.rows) {
      const orderId = localId(row.orderId)
      const order = orders.get(orderId)
      seenOrders.add(orderId)
      if (row.kind === 'refund') {
        const refundId = localId(row.merchantRefundId || '')
        seenRefunds.add(refundId)
        const refund = refunds.get(refundId)
        if (!order || !refund || refund.order_id !== orderId) {
          differences.push({ kind: 'remote_only', orderId, refundId })
        } else if (
          refund.amount_cents !== row.amountCents ||
          order.transaction_id !== row.transactionId ||
          refund.refund_id !== row.refundId
        ) {
          differences.push({ kind: 'amount_mismatch', orderId, refundId })
        } else if (refund.status !== 'succeeded') {
          differences.push({ kind: 'state_mismatch', orderId, refundId })
        }
      } else if (!order) {
        differences.push({ kind: 'remote_only', orderId })
      } else if (row.kind === 'reversal' || order.status !== 'paid') {
        differences.push({ kind: 'state_mismatch', orderId })
      } else if (
        order.amount_cents !== row.amountCents ||
        order.transaction_id !== row.transactionId
      ) {
        differences.push({ kind: 'amount_mismatch', orderId })
      }
    }
    for (const order of dayOrders) {
      if (!seenOrders.has(order.id)) {
        differences.push({ kind: 'local_only', orderId: order.id })
      }
    }
    for (const refund of dayRefunds) {
      if (!seenRefunds.has(refund.id)) {
        differences.push({
          kind: 'local_only',
          orderId: refund.order_id,
          refundId: refund.id,
        })
      }
    }
    if (!configurationId) {
      throw ErrorCode.RECONCILIATION_CONFIGURATION()
    }
    return differences
  }

  async process(id: string, force = false) {
    if (!this.gateway?.statement || !this.configuration) {
      return
    }
    const owner = randomUUID()
    const claim = await this.source
      .createQueryBuilder()
      .update('payment_reconciliations')
      .set({
        status: 'running',
        lease_owner: owner,
        lease_until: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE)',
        attempts: () => 'attempts+1',
      })
      .updateEntity(false)
      .where(
        'id=:p1 AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3)) AND (:p2 OR (status IN (\'pending\',\'failed\',\'running\') AND attempts<8 AND next_attempt_at<=UTC_TIMESTAMP(3)))',
      )
      .setParameters({ p1: id, p2: force })
      .execute()
    if (!claim.affected) {
      return
    }
    try {
      const job = await this.source
        .getRepository(PaymentReconciliationEntity)
        .findOne({
          select: {
            id: true,
            day: true,
            merchant_hash: true,
            configuration_id: true,
            status: true,
            row_count: true,
            difference_count: true,
            details_json: true,
            statement_sha1: true,
            error: true,
            attempts: true,
            lease_owner: true,
            lease_until: true,
            next_attempt_at: true,
            updated_at: true,
          },
          where: { id },
        })
      if (!job) {
        return
      }
      const day = String(job.day).slice(0, 10)
      this.checkDay(day)
      const config = await this.configuration.runtime(job.configuration_id)
      const statement = await this.gateway.statement(day, {
        configurationId: job.configuration_id,
      })
      if (
        !config ||
        statement.day !== day ||
        statement.merchantId !== config.merchantId
      ) {
        throw ErrorCode.STATEMENT_MERCHANT()
      }
      const differences = await this.compare(statement, config.id)
      await this.source.getRepository(PaymentReconciliationEntity).update(
        { id, lease_owner: owner },
        {
          status: differences.length ? 'differences' : 'completed',
          row_count: statement.rows.length,
          difference_count: differences.length,
          details_json: differences.slice(0, 500),
          statement_sha1: statement.sha1,
          error: null,
          lease_owner: null,
          lease_until: null,
          updated_at: () => 'UTC_TIMESTAMP(3)',
        },
      )
    } catch {
      await this.source.getRepository(PaymentReconciliationEntity).update(
        { id, lease_owner: owner },
        {
          status: 'failed',
          error: '渠道账单尚未生成或校验失败，请稍后核对商户配置与原账单',
          lease_owner: null,
          lease_until: null,
          next_attempt_at: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR)',
          updated_at: () => 'UTC_TIMESTAMP(3)',
        },
      )
    }
  }

  recover(): Promise<void> {
    if (this.recovering) {
      return this.recovering
    }
    if (Date.now() < this.nextSweep) {
      return Promise.resolve()
    }
    this.nextSweep = Date.now() + 60000
    this.recovering = this.sweep().finally(() => (this.recovering = undefined))
    return this.recovering
  }

  private async sweep() {
    if (
      !this.configuration ||
      !this.gateway?.statement ||
      new Date(Date.now() + 8 * 3600000).getUTCHours() < 11
    ) {
      return
    }
    const rows = await this.source
      .createQueryBuilder()
      .select(
        'id,JSON_UNQUOTE(JSON_EXTRACT(public_json,\'$.merchantId\')) AS merchantId',
      )
      .from('payment_configurations', 'payment_configurations')
      .orderBy('version', 'DESC')
      .limit(256)
      .getRawMany()
    const seen = new Set<string>()
    for (const config of rows) {
      if (!config.merchantId || seen.has(config.merchantId)) {
        continue
      }
      seen.add(config.merchantId)
      for (let offset = 1; offset <= 7; offset++) {
        await this.enqueue(dayAt(Date.now() - offset * 86400000), config)
      }
    }
    const jobs = await this.source
      .createQueryBuilder()
      .select('id')
      .from('payment_reconciliations', 'payment_reconciliations')
      .where(
        'status IN (\'pending\',\'failed\',\'running\') AND attempts<8 AND next_attempt_at<=UTC_TIMESTAMP(3)\n      AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3))',
      )
      .orderBy('day', 'DESC')
      .limit(5)
      .getRawMany()
    for (const job of jobs) {
      await this.process(job.id)
    }
  }
}
