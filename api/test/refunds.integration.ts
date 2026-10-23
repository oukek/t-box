import type {
  PaymentGateway,
  VerifiedPayment,
  VerifiedRefund,
} from '../src/payments/gateway.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { BillingService } from '../src/billing/service.js'
import { createDataSource } from '../src/db/data-source.js'
import { IdentityService } from '../src/identity/service.js'
import { PaymentRefundService } from '../src/payments/refunds.js'
import { PaymentService } from '../src/payments/service.js'
import { cleanupUsers } from './fixtures.js'
import { enableTestTariff, paymentSelection } from './quota-fixtures.js'

const source = await createDataSource().initialize()
const users: string[] = []
const billing = new BillingService(source)
let verified: VerifiedPayment
let answer!: VerifiedRefund
let submits = 0
let query = 0
let lostResponse = false
const configurationId = randomUUID()
const gateway: PaymentGateway = {
  channel: 'wechat',
  configurationId: async () => configurationId,
  async create() {
    throw new Error('unused')
  },
  async close() {},
  async query() {
    return null
  },
  async verify() {
    return verified
  },
  async refund(request, context) {
    submits++
    assert.equal(context.configurationId, configurationId)
    answer = {
      id: request.id,
      orderId: request.orderId,
      transactionId: request.transactionId,
      amountCents: request.amountCents,
      totalCents: request.totalCents,
      refundId: '500000000000' + String(submits).padStart(8, '0'),
      currency: 'CNY',
      status: 'PROCESSING',
      configurationId,
    }
    if (lostResponse) {
      throw new Error('response lost after merchant accepted')
    }
    return answer
  },
  async queryRefund(id) {
    query++
    assert.equal(id, answer.id)
    return { ...answer, status: 'SUCCESS' }
  },
}
const payments = new PaymentService(source, billing, gateway)
const refunds = new PaymentRefundService(source, billing, gateway)
try {
  const selection = await paymentSelection(billing, '2')
  await enableTestTariff(billing)
  async function order() {
    const login = await new IdentityService(source).register(
      {
        username: `refund_${randomUUID().replaceAll('-', '')}`,
        password: 'test123',
        nickname: '退款测试',
      },
      'refund-fixture',
    )
    users.push(login.user.id)
    const order = await payments.create(login.user.id, selection, randomUUID())
    verified = {
      orderId: order.id,
      transactionId: randomUUID().replaceAll('-', ''),
      amountCents: 1000,
      currency: 'CNY',
      paidAt: new Date(),
      configurationId,
    }
    await payments.notify(Buffer.from('{}'), {})
    return { userId: login.user.id, order }
  }
  const first = await order()
  const key = randomUUID()
  const repeats = await Promise.all(
    Array.from({ length: 3 }, () =>
      refunds.create(first.order.id, randomUUID(), '用户申请退款', key)),
  )
  assert.equal(submits, 1)
  assert.equal(new Set(repeats.map((value) => value.id)).size, 1)
  assert.equal((await billing.wallet(first.userId)).reserved, '12.0000')
  assert.equal((await billing.wallet(first.userId)).available, '0.0000')
  await assert.rejects(
    refunds.create(first.order.id, randomUUID(), '其他原因', key),
    { code: 'IDEMPOTENCY_CONFLICT' },
  )
  await assert.rejects(
    refunds.create(first.order.id, randomUUID(), '重复申请', randomUUID()),
    { code: 'REFUND_EXISTS' },
  )
  await assert.rejects(
    billing.begin({
      id: randomUUID(),
      userId: first.userId,
      modelId: randomUUID(),
      prices: { inputPrice: '1', outputPrice: '1', imagePrice: '1' },
      kind: 'image',
      budget: { images: 1, tier: '1k' },
      reserve: 1n,
    }),
    { code: 'QUOTA_INSUFFICIENT' },
  )
  await assert.rejects(
    refunds.accept({ ...answer, amountCents: 999, status: 'SUCCESS' }),
    { code: 'REFUND_MISMATCH' },
  )
  await assert.rejects(
    refunds.accept({
      ...answer,
      configurationId: randomUUID(),
      status: 'SUCCESS',
    }),
    { code: 'REFUND_MISMATCH' },
  )
  await Promise.all([
    refunds.accept({ ...answer, status: 'SUCCESS' }),
    refunds.accept({ ...answer, status: 'SUCCESS' }),
  ])
  assert.equal((await billing.wallet(first.userId)).balance, '0.0000')
  assert.equal((await billing.wallet(first.userId)).reserved, '0.0000')
  assert.equal(
    (
      await source.query(
        'SELECT id FROM ai_quota_entries WHERE userId=? AND kind=\'revoke\'',
        [first.userId],
      )
    ).length,
    1,
  )
  await payments.notify(Buffer.from('{}'), {})
  assert.equal(
    (await billing.wallet(first.userId)).balance,
    '0.0000',
    'Late payment callbacks cannot recredit a refunded order',
  )

  const lost = await order()
  lostResponse = true
  const uncertain = await refunds.create(
    lost.order.id,
    randomUUID(),
    '超时测试',
    randomUUID(),
  )
  assert.equal(uncertain.status, 'uncertain')
  assert.equal((await billing.wallet(lost.userId)).reserved, '12.0000')
  const submitted = submits
  await source.query(
    'UPDATE payment_refunds SET next_query_at=UTC_TIMESTAMP(3) WHERE id=?',
    [uncertain.id],
  )
  await new PaymentRefundService(source, billing, gateway).recover()
  assert.equal((await refunds.get(uncertain.id)).status, 'succeeded')
  assert.equal(
    submits,
    submitted,
    'A lost response is reconciled by query, not a second refund',
  )
  assert.ok(query >= 1)
  lostResponse = false

  const closedOrder = await order()
  const closed = await refunds.create(
    closedOrder.order.id,
    randomUUID(),
    '关闭退款测试',
    randomUUID(),
  )
  await refunds.accept({ ...answer, status: 'CLOSED' })
  assert.equal((await refunds.get(closed.id)).status, 'closed')
  assert.equal((await billing.wallet(closedOrder.userId)).available, '12.0000')

  const spent = await order()
  const usageId = randomUUID()
  await billing.begin({
    id: usageId,
    userId: spent.userId,
    modelId: randomUUID(),
    prices: { inputPrice: '0', outputPrice: '0', imagePrice: '1' },
    kind: 'image',
    budget: { images: 1, tier: '1k' },
    reserve: 1000000n,
  })
  await billing.settle(spent.userId, usageId, { images: 1 })
  const partial = await refunds.create(
    spent.order.id,
    randomUUID(),
    '已消费测试',
    randomUUID(),
  )
  assert.equal(partial.amount, '1.660000')
  assert.equal(partial.reclaimedQuota, '2.0000')
  console.log(
    'Refund integration passed: full refund/bonus reservation, concurrent idempotency, proportional unused-rights refund, verified amount/config, single quota revocation, delayed payment and restart reconciliation',
  )
} finally {
  await cleanupUsers(source, users)
  await source.destroy()
}
