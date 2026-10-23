import type {
  PaymentConfiguration,
  WechatRuntime,
} from '../src/payments/configuration.js'
import type {
  MerchantStatement,
  PaymentGateway,
  VerifiedPayment,
} from '../src/payments/gateway.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { BillingService } from '../src/billing/service.js'
import { createDataSource } from '../src/db/data-source.js'
import { IdentityService } from '../src/identity/service.js'
import { PaymentReconciliationService } from '../src/payments/reconciliation.js'
import { PaymentService } from '../src/payments/service.js'
import { cleanupUsers } from './fixtures.js'
import { paymentSelection } from './quota-fixtures.js'

const source = await createDataSource().initialize()
const users: string[] = []
const configurationId = randomUUID()
const merchantId = '1234567890'
const day = new Date(Date.now() + 8 * 3600000 - 86400000)
  .toISOString()
  .slice(0, 10)
const paidAt = new Date(`${day}T12:00:00+08:00`)
let verified: VerifiedPayment
let calls = 0
let statement: MerchantStatement = {
  day,
  merchantId,
  sha1: 'a'.repeat(40),
  rows: [],
}
const config = { id: configurationId, merchantId } as WechatRuntime
const configuration = {
  runtime: async () => config,
} as unknown as PaymentConfiguration
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
  async statement(requested, context) {
    calls++
    assert.equal(requested, day)
    assert.equal(context.configurationId, configurationId)
    return statement
  },
}
const billing = new BillingService(source)
const payments = new PaymentService(source, billing, gateway)
const service = new PaymentReconciliationService(source, gateway, configuration)
try {
  const selection = await paymentSelection(billing)
  await source.query(
    'INSERT INTO payment_configurations(id,public_json,secret_cipher,administrator_id) VALUES(?,?,?,?)',
    [
      configurationId,
      JSON.stringify({ merchantId }),
      'isolated-fixture',
      randomUUID(),
    ],
  )
  const session = await new IdentityService(source).register(
    {
      username: `reconcile_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
      nickname: '对账测试',
    },
    'reconciliation-fixture',
  )
  users.push(session.user.id)
  const orders = []
  for (let i = 0; i < 2; i++) {
    const order = await payments.create(
      session.user.id,
      selection,
      randomUUID(),
    )
    await source.query('UPDATE payment_orders SET created_at=? WHERE id=?', [
      paidAt,
      order.id,
    ])
    verified = {
      orderId: order.id,
      transactionId: `4200000000000000000${i}`,
      amountCents: 1000,
      currency: 'CNY',
      paidAt,
      configurationId,
    }
    await payments.notify(Buffer.from('{}'), {})
    orders.push({ ...order, transaction: verified.transactionId })
  }
  const first = orders[0]!
  const second = orders[1]!
  const balance = await billing.wallet(session.user.id)
  const row = (order: typeof first): MerchantStatement['rows'][number] => ({
    kind: 'payment',
    orderId: order.id.replaceAll('-', ''),
    transactionId: order.transaction,
    amountCents: 1000,
  })
  statement.rows = [row(first), row(second)]
  const equal = await service.run(day)
  assert.equal(equal.status, 'completed')
  assert.equal(equal.differences, 0)
  statement.rows = [
    row(first),
    { ...row(second), amountCents: 900 },
    {
      kind: 'payment',
      orderId: randomUUID().replaceAll('-', ''),
      transactionId: 'unknown-channel-transaction',
      amountCents: 100,
    },
  ]
  const different = await service.run(day)
  assert.equal(different.id, equal.id)
  assert.equal(different.status, 'differences')
  assert.deepEqual(different.details.map((item) => item.kind).sort(), [
    'amount_mismatch',
    'remote_only',
  ])
  statement.rows = []
  const missing = await service.run(day)
  assert.equal(missing.differences, 2)
  assert.ok(missing.details.every((item) => item.kind === 'local_only'))
  assert.deepEqual(
    await billing.wallet(session.user.id),
    balance,
    'Reconciliation never mutates funds based on CSV',
  )
  statement = { ...statement, merchantId: '9876543210' }
  assert.equal((await service.run(day)).status, 'failed')
  await assert.rejects(
    service.run(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)),
    { code: 'STATEMENT_DATE' },
  )
  assert.ok(calls >= 4)
  console.log(
    'Merchant reconciliation integration passed: exact/local/remote differences, immutable merchant-day identity, failure retention, date bounds and no wallet mutations',
  )
} finally {
  await cleanupUsers(source, users)
  await source.query(
    'DELETE FROM payment_reconciliations WHERE configuration_id=?',
    [configurationId],
  )
  await source.query('DELETE FROM payment_configurations WHERE id=?', [
    configurationId,
  ])
  await source.destroy()
}
