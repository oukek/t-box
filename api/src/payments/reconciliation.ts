import type {
  DailyReconciliation,
  ReconciliationDifference,
} from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { PaymentConfiguration } from './configuration.js'
import type { MerchantStatement, PaymentGateway } from './gateway.js'
import { createHash, randomUUID } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'
import { isoTime } from '@t-box/server-foundation/time'
import { parseDate } from '@t-box/server-foundation/validation'

const dayAt = (milliseconds: number) =>
  new Date(milliseconds + 8 * 3600000).toISOString().slice(0, 10)
const localId = (value: string) =>
  /^[a-f0-9]{32}$/i.test(value)
    ? `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`.toLowerCase()
    : value
const view = (row: any): DailyReconciliation => ({
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
})

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
      await this.source.query(
        'SELECT * FROM payment_reconciliations ORDER BY day DESC,updated_at DESC LIMIT 100',
      )
    ).map(view)
  }

  private checkDay(day: string) {
    parseDate(day)
    const today = dayAt(Date.now())
    if (day >= today || day < dayAt(Date.now() - 90 * 86400000)) {
      throw new ApiError(
        400,
        'STATEMENT_DATE',
        '请选择近 90 天内、今天之前的账单日期',
      )
    }
  }

  private async enqueue(
    day: string,
    config: { id: string, merchantId: string },
  ) {
    const hash = createHash('sha256').update(config.merchantId).digest('hex')
    await this.source.query(
      'INSERT IGNORE INTO payment_reconciliations(id,day,merchant_hash,configuration_id) VALUES(?,?,?,?)',
      [randomUUID(), day, hash, config.id],
    )
    const [row] = await this.source.query(
      'SELECT id FROM payment_reconciliations WHERE merchant_hash=? AND day=?',
      [hash, day],
    )
    return row.id as string
  }

  async run(day: string) {
    this.checkDay(day)
    const config = await this.configuration?.runtime()
    if (!config || !this.gateway?.statement) {
      throw new ApiError(
        503,
        'RECONCILIATION_UNAVAILABLE',
        '请先配置微信商户与对账权限',
      )
    }
    const id = await this.enqueue(day, config)
    await this.process(id, true)
    const [row] = await this.source.query(
      'SELECT * FROM payment_reconciliations WHERE id=?',
      [id],
    )
    return view(row)
  }

  async compare(
    statement: MerchantStatement,
    configurationId: string,
  ): Promise<ReconciliationDifference[]> {
    const start = new Date(`${statement.day}T00:00:00+08:00`)
    const end = new Date(start.getTime() + 86400000)
    const orders = new Map<string, any>()
    const refunds = new Map<string, any>()
    const dayOrders = await this.source.query(
      `SELECT o.* FROM payment_orders o JOIN payment_configurations c ON c.id=o.configuration_id
      WHERE JSON_UNQUOTE(JSON_EXTRACT(c.public_json,'$.merchantId'))=? AND o.status='paid' AND o.paid_at>=? AND o.paid_at<?`,
      [statement.merchantId, start, end],
    )
    const dayRefunds = await this.source.query(
      `SELECT r.* FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id JOIN payment_configurations c ON c.id=o.configuration_id
      WHERE JSON_UNQUOTE(JSON_EXTRACT(c.public_json,'$.merchantId'))=? AND r.status='succeeded' AND r.succeeded_at>=? AND r.succeeded_at<?`,
      [statement.merchantId, start, end],
    )
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
      const existing = await this.source.query(
        `SELECT o.* FROM payment_orders o JOIN payment_configurations c ON c.id=o.configuration_id
        WHERE o.id IN (?) AND JSON_UNQUOTE(JSON_EXTRACT(c.public_json,'$.merchantId'))=?`,
        [batch, statement.merchantId],
      )
      for (const order of existing) {
        orders.set(order.id, order)
      }
      const known = await this.source.query(
        'SELECT * FROM payment_refunds WHERE order_id IN (?)',
        [batch],
      )
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
      throw new ApiError(
        400,
        'RECONCILIATION_CONFIGURATION',
        '对账需要原商户配置',
      )
    }
    return differences
  }

  async process(id: string, force = false) {
    if (!this.gateway?.statement || !this.configuration) {
      return
    }
    const owner = randomUUID()
    const claim = await this.source.query(
      `UPDATE payment_reconciliations SET status='running',lease_owner=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE),attempts=attempts+1
      WHERE id=? AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3)) AND (? OR (status IN ('pending','failed','running') AND attempts<8 AND next_attempt_at<=UTC_TIMESTAMP(3)))`,
      [owner, id, force],
    )
    if (!claim.affectedRows) {
      return
    }
    try {
      const [job] = await this.source.query(
        'SELECT * FROM payment_reconciliations WHERE id=?',
        [id],
      )
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
        throw new ApiError(502, 'STATEMENT_MERCHANT', '对账商户或日期不一致')
      }
      const differences = await this.compare(statement, config.id)
      await this.source.query(
        `UPDATE payment_reconciliations SET status=?,row_count=?,difference_count=?,details_json=?,statement_sha1=?,error=NULL,lease_owner=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(3)
        WHERE id=? AND lease_owner=?`,
        [
          differences.length ? 'differences' : 'completed',
          statement.rows.length,
          differences.length,
          JSON.stringify(differences.slice(0, 500)),
          statement.sha1,
          id,
          owner,
        ],
      )
    } catch {
      await this.source.query(
        `UPDATE payment_reconciliations SET status='failed',error='渠道账单尚未生成或校验失败，请稍后核对商户配置与原账单',
        lease_owner=NULL,lease_until=NULL,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_owner=?`,
        [id, owner],
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
    const rows = await this.source.query(
      `SELECT id,JSON_UNQUOTE(JSON_EXTRACT(public_json,'$.merchantId')) AS merchantId FROM payment_configurations ORDER BY version DESC LIMIT 256`,
    )
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
      .query(`SELECT id FROM payment_reconciliations WHERE status IN ('pending','failed','running') AND attempts<8 AND next_attempt_at<=UTC_TIMESTAMP(3)
      AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3)) ORDER BY day DESC LIMIT 5`)
    for (const job of jobs) {
      await this.process(job.id)
    }
  }
}
