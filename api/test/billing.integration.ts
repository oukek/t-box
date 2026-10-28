import type { BillingBegin } from '../src/billing/service.js'
import type {
  PaymentGateway,
  VerifiedPayment,
  VerifiedRefund,
} from '../src/payments/gateway.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { createConnection } from 'mysql2/promise'
import OpenAI from 'openai'
import { modelRequest } from '../src/agent/model-retry.js'
import { MeteredChatProvider } from '../src/billing/provider.js'
import { initialTariff } from '../src/billing/quota/defaults.js'
import {
  QuotaAllocationEntity,
  QuotaLotEntity,
} from '../src/billing/quota/entities.js'
import { quota } from '../src/billing/quota/math.js'
import { registerBilling } from '../src/billing/routes.js'
import { BillingService } from '../src/billing/service.js'
import { registerQuotaSocket } from '../src/billing/socket.js'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { initializeDatabase } from '../src/db/initialize.js'
import { databaseSchemas } from '../src/db/schema/index.js'
import { IdentityService } from '../src/identity/service.js'
import { PaymentRefundService } from '../src/payments/refunds.js'
import { PaymentService } from '../src/payments/service.js'
import { PlatformService } from '../src/platform/service.js'

// Never changes the developer database; every assertion runs against a fresh disposable schema.
const config = getConfig().mysql
const { database: _db, ...connection } = config
const admin = await createConnection(connection)
const database = `t_box_test_quota_${randomUUID().replaceAll('-', '')}`
await admin.query(
  `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
)
const source = await createDataSource({ ...config, database }).initialize()
const billing = new BillingService(source)
const administrator = randomUUID()
const prices = {
  inputPrice: '1',
  outputPrice: '2',
  imagePrice: '0.2',
  costMultiplier: '0.8',
}
const tokens = new Map<string, string>()
async function user() {
  const session = await new IdentityService(source, undefined, 'internal').register(
    { username: `q_${randomUUID().replaceAll('-', '')}`, password: 'test123' },
    'quota-fixture',
  )
  tokens.set(session.user.id, session.token)
  return session.user.id
}
const begin = (
  userId: string,
  patch: Partial<BillingBegin> = {},
): BillingBegin => ({
  id: randomUUID(),
  userId,
  modelId: randomUUID(),
  prices,
  kind: 'image',
  reserve: 200000n,
  budget: { images: 1, tier: '1k' },
  ...patch,
})
async function grant(userId: string, amount: string, days = 180) {
  await billing.grant(
    userId,
    amount,
    randomUUID(),
    '测试赠送',
    administrator,
    days,
  )
}
async function expectAvailable(userId: string, amount: string) {
  assert.equal((await billing.wallet(userId)).available, amount)
}
try {
  await initializeDatabase(source, databaseSchemas)
  const configuration = {
    ...initialTariff,
    enabled: true,
    inputPerMillion: '1',
    outputPerMillion: '2',
    cachedInputPerMillion: '0.1',
  }
  const { version: _v, publishedAt: _at, ...draft } = configuration
  await billing.catalog.publishTariff(draft, 1, administrator)

  // FEFO allocation and capture order, unused holds, public data minimization.
  const owner = await user()
  await grant(owner, '20', 180)
  await grant(owner, '4', 1)
  const request = begin(owner)
  await billing.begin(request)
  assert.equal((await billing.wallet(owner)).reserved, '10.0000')
  await billing.settle(owner, request.id, { images: 1 })
  await billing.settle(owner, request.id, { images: 1 })
  await expectAvailable(owner, '14.0000')
  const lots = await billing.lots(owner)
  assert.equal(lots.find((lot) => lot.total === '4.0000')!.consumed, '4.0000')
  assert.equal(lots.find((lot) => lot.total === '20.0000')!.consumed, '6.0000')
  assert.equal('sourceKey' in lots[0]!, false)
  assert.equal('userId' in lots[0]!, false)
  const receipt = (await billing.records(owner))[0]!
  assert.equal(receipt.allocations?.length, 2)
  assert.equal('prices_json' in receipt, false)
  await assert.rejects(
    billing.settle(owner, request.id, { images: 1, responseId: 'different' }),
    { code: 'USAGE_CONFLICT' },
  )
  await Promise.all([
    billing.failed(owner, request.id),
    billing.failed(owner, request.id),
  ])
  await expectAvailable(owner, '24.0000')
  assert.equal((await billing.records(owner))[0]!.status, 'reversed')
  assert.equal(
    (
      await source.query('SELECT fee_micro FROM billing_usage WHERE id=?', [
        request.id,
      ])
    )[0].fee_micro,
    '160000',
  )

  // Parallel admissions cannot spend the same credits; rejected admission commits no usage.
  const concurrent = await user()
  await grant(concurrent, '15')
  const parallel = [begin(concurrent), begin(concurrent)]
  const admissions = await Promise.allSettled(
    parallel.map((r) => billing.begin(r)),
  )
  assert.equal(admissions.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal((await billing.wallet(concurrent)).reserved, '10.0000')
  assert.equal((await billing.records(concurrent)).length, 1)
  const accepted =
    parallel[admissions.findIndex((r) => r.status === 'fulfilled')]!
  await billing.failed(concurrent, accepted.id)
  await expectAvailable(concurrent, '15.0000')
  await billing.release(concurrent, accepted.id, administrator, '已确认无结果')
  await assert.rejects(billing.settle(concurrent, accepted.id, { images: 1 }), {
    code: 'USAGE_RELEASED',
  })

  // Free users need no inventory, keep usage/cost/would-charge, and freeze mode per actual attempt.
  const free = await user()
  await billing.setMode(free, 'record_only', administrator, '免费用户')
  const noDebit = begin(free)
  await billing.begin(noDebit)
  await billing.setMode(free, 'charge', administrator, '模式修改')
  await billing.settle(free, noDebit.id, {
    images: 1,
    inputTokens: 100,
    outputTokens: 50,
  })
  const waived = (await billing.records(free))[0]!
  assert.equal(waived.fee, '10.0000')
  assert.equal(waived.charged, '0.0000')
  assert.equal((await billing.entries(free)).length, 0)
  assert.equal((await billing.lots(free)).length, 0)
  await grant(free, '20')
  const charged = begin(free)
  await billing.begin(charged)
  await billing.setMode(free, 'record_only', administrator, '切回免费')
  await billing.settle(free, charged.id, { images: 1 })
  await expectAvailable(free, '10.0000')

  // Task tariff snapshots, image count and total credit envelope apply to free users too.
  const taskId = randomUUID()
  for (let n = 0; n < 3; n++) {
    const call = begin(free, { taskId, budget: { images: 1, tier: '4k' } })
    await billing.begin(call)
    await billing.settle(free, call.id, { images: 1 })
  }
  await assert.rejects(billing.begin(begin(free, { taskId })), {
    code: 'QUOTA_TASK_LIMIT',
  })
  const pinned = begin(owner, {
    taskId: randomUUID(),
    budget: { inputTokens: 1000000, outputTokens: 0 },
    kind: 'conversation',
  })
  await billing.begin(pinned)
  await billing.settle(owner, pinned.id, {
    inputTokens: 1000000,
    outputTokens: 0,
    cachedInputTokens: 500000,
  })
  const tariff = await billing.catalog.tariff()
  const { version: tariffVersion, publishedAt: _time, ...nextTariff } = tariff
  await billing.catalog.publishTariff(
    { ...nextTariff, inputPerMillion: '10' },
    tariffVersion,
    administrator,
  )
  const next = begin(owner, {
    taskId: pinned.taskId,
    kind: 'conversation',
    budget: { inputTokens: 1000000, outputTokens: 0 },
  })
  await billing.begin(next)
  await billing.settle(owner, next.id, {
    inputTokens: 1000000,
    outputTokens: 0,
  })
  assert.equal(
    (await billing.records(owner)).find((r) => r.id === next.id)!.fee,
    '1.0000',
  )

  // Expiration during an admitted call: successful part can settle, returned authorization expires.
  const expiring = await user()
  await grant(expiring, '20', 1)
  const held = begin(expiring, {
    kind: 'conversation',
    budget: { inputTokens: 1000000, outputTokens: 0 },
  })
  await billing.begin(held)
  await source.getRepository(QuotaLotEntity).update(
    { userId: expiring },
    {
      expiresAt: new Date(Date.now() - 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, -1),
    },
  )
  await billing.settle(expiring, held.id, {
    inputTokens: 500000,
    outputTokens: 0,
  })
  await expectAvailable(expiring, '0.0000')
  assert.equal((await billing.lots(expiring))[0]!.expired, '15.0000')
  await billing.failed(expiring, held.id)
  assert.equal((await billing.lots(expiring))[0]!.expired, '20.0000')

  // Abnormal upstream overrun never debits unreserved lots. Fee and real cost remain auditable.
  const overrun = await user()
  await grant(overrun, '50')
  const bounded = begin(overrun, {
    kind: 'conversation',
    budget: { inputTokens: 100000, outputTokens: 0 },
  })
  await billing.begin(bounded)
  await billing.settle(overrun, bounded.id, {
    inputTokens: 1000000,
    outputTokens: 0,
  })
  await expectAvailable(overrun, '49.0000')
  assert.equal((await billing.records(overrun))[0]!.fee, '10.0000')

  // Provider reports usage then fails: automatically reverse the early settlement.
  const provider = new MeteredChatProvider(
    {
      mode: 'openai',
      maxOutputTokens: 100,
      async next(input) {
        await input.onUsage?.({
          inputTokens: 10,
          outputTokens: 10,
          responseId: 'failed-after-usage',
        })
        throw new OpenAI.APIConnectionError({ message: 'fixture disconnect' })
      },
    },
    billing,
    randomUUID(),
    prices,
  )
  const oldBalance = (await billing.wallet(overrun)).available
  await assert.rejects(
    provider.next({
      execution: { userId: overrun, operationId: randomUUID() },
      history: [],
      tools: [],
      instructions: '',
      localDate: '',
      signal: new AbortController().signal,
      onDelta() {},
    }),
  )
  await expectAvailable(overrun, oldBalance)

  // Five failed attempts reverse early charges; the sixth success charges once.
  const retryTask = randomUUID()
  let attempts = 0
  const retries = new MeteredChatProvider(
    {
      mode: 'openai',
      maxOutputTokens: 100,
      async next(input) {
        attempts++
        await input.onUsage?.({
          inputTokens: 10,
          outputTokens: 10,
          responseId: `retry-${attempts}`,
        })
        if (attempts <= 5) {
          throw new OpenAI.APIConnectionError({ message: 'fixture transient' })
        }
        return { output: [], calls: [] }
      },
    },
    billing,
    randomUUID(),
    prices,
  )
  await modelRequest(
    'next',
    {
      execution: {
        userId: overrun,
        taskId: retryTask,
        operationId: randomUUID(),
      },
      history: [],
      tools: [],
      instructions: '',
      localDate: '',
      signal: new AbortController().signal,
      onDelta() {},
    },
    (input) => retries.next(input),
    {
      records: {},
      async save() {},
      async onRetry() {},
      async onUsage() {},
      async wait() {},
      random: () => 0,
    },
  )
  assert.equal(attempts, 6)
  const retryRecords = (await billing.records(overrun)).filter(
    (r) => r.taskId === retryTask,
  )
  assert.equal(retryRecords.length, 6)
  assert.equal(retryRecords.filter((r) => r.status === 'reversed').length, 5)
  assert.equal(retryRecords.filter((r) => r.status === 'settled').length, 1)
  assert.equal(
    retryRecords.reduce((sum, r) => sum + quota(r.charged), 0n),
    2n,
  )
  const stale = begin(overrun)
  await billing.begin(stale)
  await source.query(
    'UPDATE billing_usage SET updated_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 11 MINUTE) WHERE id=?',
    [stale.id],
  )
  await billing.recover()
  assert.equal((await billing.wallet(overrun)).reserved, '0.0000')
  assert.equal(
    (await billing.records(overrun)).find((r) => r.id === stale.id)!.status,
    'review',
  )

  // Order snapshots and signed/verified fulfillment are idempotent, edits do not change rights.
  const productDraft = {
    code: 'fixture',
    name: '测试资源包',
    price: '10.00',
    quota: '100',
    bonusQuota: '20',
    validDays: 180,
    description: '',
    sort: 99,
    enabled: true,
  }
  const productId = await billing.catalog.save(productDraft)
  await billing.catalog.publish(productId, 1)
  let verified: VerifiedPayment
  let answer: VerifiedRefund
  let refundSubmits = 0
  const gateway: PaymentGateway = {
    channel: 'wechat',
    async create() {
      return { type: 'redirect', url: 'https://pay.example.test' }
    },
    async close() {},
    async query() {
      return verified
    },
    async verify() {
      return verified
    },
    async refund(request) {
      refundSubmits++
      answer = {
        id: request.id,
        orderId: request.orderId,
        transactionId: request.transactionId,
        amountCents: request.amountCents,
        totalCents: request.totalCents,
        refundId: 'fixture-refund',
        currency: 'CNY',
        status: 'PROCESSING',
      }
      return answer
    },
    async queryRefund() {
      return { ...answer, status: 'SUCCESS' }
    },
  }
  const payments = new PaymentService(source, billing, gateway)
  const purchaser = await user()
  const orderKey = randomUUID()
  const order = await payments.create(
    purchaser,
    { packageId: productId, version: 1 },
    orderKey,
  )
  assert.equal(
    (
      await payments.create(
        purchaser,
        { packageId: productId, version: 1 },
        orderKey,
      )
    ).id,
    order.id,
  )
  await assert.rejects(
    payments.create(purchaser, { packageId: productId, version: 2 }, orderKey),
    { code: 'IDEMPOTENCY_CONFLICT' },
  )
  await billing.catalog.save(
    { ...productDraft, bonusQuota: '30' },
    productId,
    2,
  )
  await billing.catalog.publish(productId, 3)
  verified = {
    orderId: order.id,
    amountCents: 999,
    currency: 'CNY',
    transactionId: randomUUID(),
    paidAt: new Date(),
  }
  await assert.rejects(payments.notify(Buffer.from('{}'), {}), {
    code: 'PAYMENT_MISMATCH',
  })
  verified.amountCents = 1000
  await Promise.all([
    payments.notify(Buffer.from('{}'), {}),
    payments.notify(Buffer.from('{}'), {}),
  ])
  await expectAvailable(purchaser, '120.0000')
  assert.equal((await billing.lots(purchaser)).length, 1)
  assert.equal((await payments.get(purchaser, order.id)).bonusQuota, '20')
  const spent = begin(purchaser)
  await billing.begin(spent)
  await billing.settle(purchaser, spent.id, { images: 1 })
  const refunds = new PaymentRefundService(source, billing, gateway)
  const refundKey = randomUUID()
  const refund = await refunds.create(
    order.id,
    administrator,
    '未使用权益退款',
    refundKey,
  )
  assert.equal(refund.amount, '9.160000')
  assert.equal(refund.reclaimedQuota, '110.0000')
  assert.equal(
    (await refunds.create(order.id, administrator, '未使用权益退款', refundKey))
      .id,
    refund.id,
  )
  assert.equal(refundSubmits, 1)
  await refunds.accept({ ...answer!, status: 'SUCCESS' })
  await expectAvailable(purchaser, '0.0000')
  assert.equal((await billing.lots(purchaser))[0]!.revoked, '110.0000')
  await payments.notify(Buffer.from('{}'), {})
  await expectAvailable(purchaser, '0.0000')
  assert.equal((await refunds.forUser(purchaser)).length, 1)
  assert.equal((await refunds.forUser(owner)).length, 0)

  // REST ownership and websocket hints: no client-supplied price or supplier metadata leaks.
  const platform = new PlatformService(source)
  Object.assign(platform, { billing, payments, refunds })
  const http = Fastify()
  registerBilling(http, platform)
  await http.register(websocket)
  await http.register(async (scope) => {
    registerQuotaSocket(scope, platform, new Set(['*']))
  })
  await http.ready()
  try {
    const authorization = { authorization: `Bearer ${tokens.get(purchaser)}` }
    assert.equal(
      (await http.inject({ method: 'GET', url: '/api/v1/wallet' })).statusCode,
      401,
    )
    const owned = await http.inject({
      method: 'GET',
      url: '/api/v1/wallet/refunds',
      headers: authorization,
    })
    assert.equal(owned.statusCode, 200)
    assert.equal(owned.json().data.length, 1)
    const foreign = await http.inject({
      method: 'GET',
      url: '/api/v1/wallet/refunds',
      headers: { authorization: `Bearer ${tokens.get(owner)}` },
    })
    assert.equal(foreign.json().data.length, 0)
    const publicUsage = await http.inject({
      method: 'GET',
      url: '/api/v1/wallet/usage',
      headers: authorization,
    })
    assert.equal(publicUsage.statusCode, 200)
    for (const key of [
      'prices_json',
      'model_config_id',
      'fee_micro',
      'upstream_original_micro',
    ]) {
      assert.equal(publicUsage.body.includes(key), false)
    }
    const invalid = await http.inject({
      method: 'POST',
      url: '/api/v1/payments/orders',
      headers: { ...authorization, 'idempotency-key': randomUUID() },
      payload: { packageId: productId, version: 2, amount: '0.01' },
    })
    assert.equal(invalid.statusCode, 400)
    const socket = await http.injectWS('/api/v1/wallet/ws')
    const ready = once(socket, 'message')
    socket.send(
      JSON.stringify({ type: 'authenticate', token: tokens.get(owner) }),
    )
    assert.equal(JSON.parse(String((await ready)[0])).type, 'ready')
    const change = once(socket, 'message')
    await grant(owner, '1')
    assert.equal(JSON.parse(String((await change)[0])).type, 'quota.changed')
    const closed = once(socket, 'close')
    socket.close()
    await closed
  } finally {
    await http.close()
  }

  // All lot and allocation conservation invariants survive every preceding concurrency/failure path.
  const allLots = await source.getRepository(QuotaLotEntity).find()
  for (const lot of allLots) {
    assert.equal(
      BigInt(lot.total),
      BigInt(lot.available) +
      BigInt(lot.reserved) +
      BigInt(lot.consumed) +
      BigInt(lot.expired) +
      BigInt(lot.revoked),
    )
  }
  for (const a of await source.getRepository(QuotaAllocationEntity).find()) {
    assert.equal(
      BigInt(a.allocated),
      BigInt(a.reserved) + BigInt(a.consumed) + BigInt(a.released),
    )
  }
  assert.equal(quota('1'), 10000n)
  console.log(
    'Quota integration passed: real MySQL concurrency, FEFO, expiration, free-user snapshots, task caps, tariff pinning, overrun, failure reversal, payment version snapshots and proportional refunds',
  )
} finally {
  await source.destroy()
  await admin.query(`DROP DATABASE \`${database}\``)
  await admin.end()
}
