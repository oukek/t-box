import type { ChatServerEvent } from '@t-box/shared'
import type OpenAI from 'openai'
import type { ProviderInput } from '../src/chat/provider.js'
import type {
  PaymentGateway,
  VerifiedPayment,
} from '../src/payments/gateway.js'
/** Real disposable MySQL identities, local image server, trusted fake payment adapter. No real money/model requests. */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { createVault, hashPassword } from '../src/admin/crypto.js'
import { ConfigurationService } from '../src/admin/service.js'
import { AdminStore } from '../src/admin/store.js'
import { createApp } from '../src/app.js'
import { money, prices } from '../src/billing/money.js'
import { MeteredChatProvider } from '../src/billing/provider.js'
import { ApplicationChatService } from '../src/bootstrap/chat.js'
import {
  OpenAIResponsesProvider,
} from '../src/chat/provider.js'
import { createDataSource } from '../src/db/data-source.js'
import { RechargeSettingsService } from '../src/payments/recharge.js'
import { PaymentService } from '../src/payments/service.js'
import { PlatformService } from '../src/platform/service.js'
import { ImageTools } from '../src/resources/images.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const p = new PlatformService(source)
const users: string[] = []
const adminId = randomUUID()
const modelId = randomUUID()
const secret = randomBytes(24).toString('hex')
const price = prices({ inputPrice: '1', outputPrice: '2', imagePrice: '0.25' })
let verified: VerifiedPayment | null = null
const gateway: PaymentGateway = {
  channel: 'wechat',
  async create(order) {
    return { type: 'redirect', url: `https://pay.example.test/${order.id}` }
  },
  async close() {},
  async query() {
    return verified
  },
  async verify(raw, headers) {
    assert.equal(headers['x-test-signature'], 'trusted-test-signature')
    assert.equal(raw.toString(), '{\n  "fixture": true\n}')
    if (!verified) {
      throw new Error('missing fixture')
    }
    return verified
  },
}
const payments = new PaymentService(source, p.billing, gateway, {
  async bonusCents() {
    return 0
  },
})
const configuration = new ConfigurationService(
  new AdminStore(source),
  createVault(randomBytes(32)),
)
const app = createApp({
  platform: p,
  administration: configuration,
  bills: createBillRepository(source),
  health: async () => ({ mysql: 'up', redis: 'disabled' }),
})
const remote = createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(
    JSON.stringify({
      data: [
        {
          b64_json:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=',
        },
      ],
    }),
  )
})
try {
  await source.query(
    'INSERT INTO admin_users(id,username,password_hash) VALUES(?,?,?)',
    [adminId, `billing_${adminId.slice(0, 8)}`, await hashPassword(secret)],
  )
  const a = await p.identity.register(
    {
      username: `billing_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
    },
    'billing-a',
  )
  users.push(a.user.id)
  const b = await p.identity.register(
    {
      username: `billing_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
    },
    'billing-b',
  )
  users.push(b.user.id)
  const uid = a.user.id
  const headers = { authorization: `Bearer ${a.token}` }
  await p.billing.grant(uid, '1', randomUUID(), 'fixture', adminId)
  const grantKey = randomUUID()
  await Promise.all([
    p.billing.grant(uid, '1', grantKey, 'fixture', adminId),
    p.billing.grant(uid, '1', grantKey, 'fixture', adminId),
  ])
  assert.equal((await p.billing.wallet(uid)).balance, '2.000000')
  await assert.rejects(p.billing.grant(uid, '2', grantKey, 'fixture', adminId))
  console.info(
    '✓ Audited credits are idempotent and reject changed retry parameters',
  )
  const id = randomUUID()
  await p.billing.begin({
    id,
    userId: uid,
    modelId,
    prices: price,
    kind: 'conversation',
    reserve: 1_000_000n,
  })
  await Promise.all([
    p.billing.settle(uid, id, {
      inputTokens: 100_000,
      outputTokens: 100_000,
      responseId: 'fixture-response',
    }),
    p.billing.settle(uid, id, {
      inputTokens: 100_000,
      outputTokens: 100_000,
      responseId: 'fixture-response',
    }),
  ])
  assert.equal((await p.billing.wallet(uid)).balance, '1.700000')
  const races = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      p.billing.begin({
        id: randomUUID(),
        userId: uid,
        modelId,
        prices: price,
        kind: 'image',
        reserve: 1_000_000n,
      })),
  )
  assert.equal(races.filter((x) => x.status === 'fulfilled').length, 1)
  const held = (await p.billing.records(uid)).find(
    (x) => x.status === 'reserved',
  )!
  await p.billing.uncertain(uid, held.id)
  await p.billing.release(uid, held.id, adminId, 'fixture result unknown')
  assert.equal((await p.billing.wallet(uid)).reserved, '0.000000')
  await assert.rejects(
    p.billing.settle(uid, id, {
      inputTokens: 1,
      outputTokens: 1,
      responseId: 'fixture-response',
    }),
  )
  console.info(
    '✓ Concurrent reservation, actual settlement and duplicate settlement preserve balance',
  )
  await p.billing.setMode(b.user.id, 'record_only', adminId, 'fixture mode')
  const freeId = randomUUID()
  await p.billing.begin({
    id: freeId,
    userId: b.user.id,
    modelId,
    prices: price,
    kind: 'conversation',
    reserve: 1_000_000n,
  })
  await p.billing.settle(b.user.id, freeId, {
    inputTokens: 100_000,
    outputTokens: 100_000,
  })
  const free = (await p.billing.records(b.user.id))[0]!
  assert.equal(free.fee, '0.300000')
  assert.equal(free.charged, '0.000000')
  assert.equal((await p.billing.wallet(b.user.id)).balance, '0.000000')
  const snapshot = randomUUID()
  await p.billing.begin({
    id: snapshot,
    userId: uid,
    modelId,
    prices: price,
    kind: 'image',
    reserve: 250_000n,
  })
  await p.billing.setMode(uid, 'record_only', adminId, 'change after dispatch')
  await p.billing.settle(uid, snapshot, { images: 1 })
  assert.equal(
    (await p.billing.records(uid)).find((r) => r.id === snapshot)!.charged,
    '0.250000',
  )
  await p.billing.setMode(uid, 'charge', adminId, 'restore fixture')
  console.info(
    '✓ Record-only tracks fees without debit; in-flight calls retain pricing/mode snapshots',
  )
  const over = randomUUID()
  await p.billing.begin({
    id: over,
    userId: uid,
    modelId,
    prices: price,
    kind: 'conversation',
    reserve: 10_000n,
  })
  await assert.rejects(
    p.billing.settle(uid, over, { inputTokens: 10_000_000, outputTokens: 0 }),
  )
  assert.equal(
    (await p.billing.records(uid)).find((x) => x.id === over)!.status,
    'review',
  )
  await p.billing.grant(uid, '10', randomUUID(), 'reconcile fixture', adminId)
  await p.billing.resolve(uid, over, adminId, 'settle reported usage')
  await p.billing.resolve(uid, over, adminId, 'idempotent reconcile fixture')
  assert.equal(
    (await p.billing.records(uid)).find((r) => r.id === over)!.charged,
    '10.000000',
  )
  const before = (await p.billing.wallet(uid)).balance
  let titles = 0
  const provider = new MeteredChatProvider(
    {
      mode: 'openai',
      async title() {
        titles++
        return 'free-title'
      },
      async next(input) {
        await input.onUsage?.({
          inputTokens: 10,
          outputTokens: 5,
          responseId: randomUUID(),
        })
        return { output: [], calls: [] }
      },
    },
    p.billing,
    modelId,
    price,
  )
  const input: ProviderInput = {
    history: [{ role: 'user', content: 'fixture' }],
    tools: [],
    instructions: 'fixture',
    localDate: '2026-10-06',
    signal: new AbortController().signal,
    onDelta() {},
    execution: { userId: uid, operationId: randomUUID() },
  }
  await provider.next(input)
  await provider.next({
    ...input,
    execution: { userId: uid, operationId: randomUUID() },
  })
  await provider.title({ text: 'fixture', signal: input.signal })
  assert.equal(titles, 1)
  assert.equal(
    money(before) - money((await p.billing.wallet(uid)).balance),
    40n,
  )
  const unknownId = randomUUID()
  const unknown = new MeteredChatProvider(
    {
      mode: 'openai',
      async next() {
        return { output: [], calls: [] }
      },
    },
    p.billing,
    modelId,
    price,
  )
  await assert.rejects(
    unknown.next({
      ...input,
      execution: { userId: uid, operationId: unknownId },
    }),
  )
  assert.equal(
    (await p.billing.records(uid)).find((x) => x.id === unknownId)!.status,
    'review',
  )
  await p.billing.release(uid, unknownId, adminId, 'missing usage fixture')
  const waivedUnknown = randomUUID()
  await unknown.next({
    ...input,
    execution: { userId: b.user.id, operationId: waivedUnknown },
  })
  assert.equal(
    (await p.billing.records(b.user.id)).find((r) => r.id === waivedUnknown)!
      .status,
    'review',
  )
  assert.equal((await p.billing.wallet(b.user.id)).reserved, '0.000000')
  const freeUnknown = randomUUID()
  const freeProvider = new MeteredChatProvider(
    {
      mode: 'openai',
      async next() {
        return { output: [], calls: [] }
      },
    },
    p.billing,
    modelId,
    prices({}),
  )
  await freeProvider.next({
    ...input,
    execution: { userId: uid, operationId: freeUnknown },
  })
  assert.equal(
    (await p.billing.records(uid)).find((r) => r.id === freeUnknown)!.charged,
    '0.000000',
  )
  console.info(
    '✓ Each model loop is metered once, titles bypass billing, missing usage stays reviewable',
  )
  const chat = new ApplicationChatService({
    platform: p,
    provider,
    bills: createBillRepository(source),
  })
  const events: ChatServerEvent[] = []
  const connection = chat.connect((e) => events.push(structuredClone(e)))
  const chatBalance = (await p.billing.wallet(uid)).balance
  try {
    await connection.receive({ type: 'session.open', authToken: a.token })
    await connection.receive({
      type: 'message.send',
      requestId: randomUUID(),
      text: '普通会话计费测试',
      localDate: '2026-10-06',
    })
    const deadline = Date.now() + 5000
    while (!events.some((e) => e.type === 'run.finished')) {
      if (Date.now() > deadline) {
        throw new Error('Missing metered chat completion')
      }
      await new Promise((r) => setTimeout(r, 5))
    }
    const result = events.find((e) => e.type === 'run.finished')!
    assert.equal(result.status, 'completed', JSON.stringify(result.snapshot))
    assert.equal(
      money(chatBalance) - money((await p.billing.wallet(uid)).balance),
      20n,
    )
    assert.ok(
      (await p.billing.records(uid)).some(
        (r) =>
          r.taskId === result.runId &&
          r.messageId === result.snapshot.messages.at(-1)!.id &&
          r.agentId === 'assistant',
      ),
    )
    assert.equal(result.snapshot.messages.at(-1)!.usage!.totalTokens, 15)
    assert(events.some((e) => e.type === 'message.usage'))
    assert.equal(titles, 2)
    console.info(
      '✓ Authenticated task orchestration supplies billing identity and meters the whole conversation without title fees',
    )
  } finally {
    connection.close()
    await chat.close()
  }
  const compactId = randomUUID()
  const compactProvider = new MeteredChatProvider(
    {
      mode: 'openai',
      contextPolicy: {
        maxInputTokens: 32768,
        compaction: true,
        promptCacheKey: false,
      },
      async next() {
        return { output: [], calls: [] }
      },
      async compact(value) {
        await value.onUsage?.({
          inputTokens: 10,
          outputTokens: 5,
          cachedInputTokens: 6,
          reasoningTokens: 2,
          durationMs: 12,
          responseId: 'compact-billing-fixture',
        })
        return [{ type: 'compaction', encrypted_content: 'opaque' }]
      },
    },
    p.billing,
    modelId,
    price,
  )
  let meteredCompact = false
  await compactProvider.compact({
    ...input,
    execution: {
      userId: uid,
      operationId: compactId,
      messageId: randomUUID(),
      agentId: 'fixture-specialist',
    },
    onUsage: async () => {
      meteredCompact = true
    },
  })
  const compactRecord = (await p.billing.records(uid)).find(
    (x) => x.id === compactId,
  )!
  assert.equal(compactRecord.purpose, 'compaction')
  assert.equal(compactRecord.fee, '0.000020')
  assert.equal(compactRecord.cachedInputTokens, 6)
  assert.equal(compactRecord.reasoningTokens, 2)
  assert(meteredCompact)
  // SDK terminal-event usage is processed even if the response is incomplete.
  const sdk = {
    responses: {
      async create() {
        return (async function* () {
          yield {
            type: 'response.incomplete',
            response: {
              id: 'sdk-partial',
              output: [],
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          }
        })()
      },
    },
  } as unknown as OpenAI
  const partial = new MeteredChatProvider(
    new OpenAIResponsesProvider(
      { apiKey: 'fixture', model: 'private-fixture' },
      sdk,
    ),
    p.billing,
    modelId,
    price,
  )
  const partialId = randomUUID()
  await assert.rejects(
    partial.next({
      ...input,
      execution: { userId: uid, operationId: partialId },
    }),
  )
  assert.equal(
    (await p.billing.records(uid)).find((x) => x.id === partialId)!.charged,
    '0.000020',
  )
  await new Promise<void>((r) => remote.listen(0, '127.0.0.1', r))
  const imageConfig = {
    async runtime() {
      return {
        model: 'private-image',
        providerId: modelId,
        modelName: 'Fixture image model',
        providerName: 'Local billing fixture',
        apiKey: 'fixture',
        baseURL: `http://127.0.0.1:${(remote.address() as { port: number }).port}/v1`,
        billingModelId: modelId,
        prices: price,
      }
    },
  } as unknown as ConfigurationService
  const imageTool = new ImageTools(p.resources, imageConfig, p.billing)
  const imageBefore = (await p.billing.wallet(uid)).balance
  await imageTool.forRun(
    await p.identity.authenticate(a.token),
    new AbortController().signal,
  )({ prompt: 'fixture image' })
  assert.equal(
    money(imageBefore) - money((await p.billing.wallet(uid)).balance),
    250_000n,
  )
  console.info(
    '✓ SDK incomplete responses charge known usage; image output charges per successful image',
  )
  const orderKey = randomUUID()
  const order = await payments.create(uid, '10.00', orderKey)
  assert.equal((await payments.create(uid, '10', orderKey)).id, order.id)
  await assert.rejects(payments.create(uid, '11', orderKey))
  await assert.rejects(payments.get(b.user.id, order.id))
  verified = {
    orderId: order.id,
    transactionId: 'fixture-transaction',
    amountCents: 1000,
    currency: 'CNY',
    paidAt: new Date(),
  }
  const raw = Buffer.from('{\n  "fixture": true\n}')
  const signed = { 'x-test-signature': 'trusted-test-signature' }
  await assert.rejects(payments.notify(raw, {}))
  verified = { ...verified, amountCents: 999 }
  await assert.rejects(payments.notify(raw, signed))
  verified = { ...verified, currency: 'USD' as VerifiedPayment['currency'] }
  await assert.rejects(payments.notify(raw, signed))
  verified = { ...verified, amountCents: 1000, currency: 'CNY' }
  const balanceBefore = (await p.billing.wallet(uid)).balance
  await Promise.all(
    Array.from({ length: 4 }, () => payments.notify(raw, signed)),
  )
  assert.equal(
    money((await p.billing.wallet(uid)).balance) - money(balanceBefore),
    10_000_000n,
  )
  assert.equal((await payments.get(uid, order.id)).status, 'paid')
  const otherOrder = await payments.create(uid, '10', randomUUID())
  verified = { ...verified, orderId: otherOrder.id }
  await assert.rejects(payments.notify(raw, signed))
  assert.equal((await payments.get(uid, otherOrder.id)).status, 'pending')
  verified = {
    ...verified,
    transactionId: 'fixture-invalid-time',
    paidAt: new Date(Date.parse(otherOrder.createdAt) - 2000),
  }
  await assert.rejects(payments.notify(raw, signed))
  assert.equal((await payments.get(uid, otherOrder.id)).status, 'pending')
  console.info(
    '✓ Verified amount/currency/ownership and unique transaction prevent forged or duplicate payment credit',
  )
  await source.query(
    'UPDATE payment_orders SET created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE) WHERE id=?',
    [otherOrder.id],
  )
  verified = {
    ...verified,
    paidAt: new Date(),
    transactionId: 'fixture-expired',
  }
  await assert.rejects(payments.notify(raw, signed))
  assert.equal((await payments.get(uid, otherOrder.id)).status, 'pending')
  const closed = await payments.create(uid, '1', randomUUID())
  await payments.close(uid, closed.id)
  verified = {
    ...verified,
    orderId: closed.id,
    amountCents: 100,
    transactionId: 'fixture-delayed',
    paidAt: new Date(Math.floor(Date.now() / 1000) * 1000),
  }
  await payments.notify(raw, signed)
  assert.equal((await payments.get(uid, closed.id)).status, 'paid')
  // Fake bonus policy, real MySQL order snapshots and signed fake channel events.
  // No changes to the live recharge configuration or model selection.
  let promotionBonus = 201
  const packagePolicy = new RechargeSettingsService({
    getRepository: () => ({
      async findOneBy() {
        return {
          configuration: {
            presets: [
              {
                amount: '10.01',
                bonusAmount: (promotionBonus / 100).toFixed(2),
                enabled: true,
              },
            ],
            customEnabled: false,
            bonusRules: [],
            minAmount: '1',
            maxAmount: '10000',
          },
          revision: 1,
          updatedAt: null,
        }
      },
    }),
  } as unknown as import('typeorm').DataSource)
  const promoted = new PaymentService(
    source,
    p.billing,
    gateway,
    packagePolicy,
  )
  await assert.rejects(promoted.create(uid, '10.02', randomUUID()), {
    code: 'CUSTOM_RECHARGE_DISABLED',
  })
  const promotionalKey = randomUUID()
  const promotional = await promoted.create(uid, '10.01', promotionalKey)
  assert.equal(promotional.bonusAmount, '2.010000')
  assert.equal(promotional.creditedAmount, '12.020000')
  promotionBonus = 999
  assert.equal(
    (await promoted.create(uid, '10.01', promotionalKey)).bonusAmount,
    '2.010000',
  )
  const beforePromotion = money((await p.billing.wallet(uid)).balance)
  verified = {
    orderId: promotional.id,
    transactionId: 'fixture-bonus-transaction',
    amountCents: 1202,
    currency: 'CNY',
    paidAt: new Date(),
  }
  await assert.rejects(promoted.notify(raw, signed)) // Channel verifies real payment, not credited balance.
  verified = { ...verified, amountCents: 1001 }
  await Promise.all(
    Array.from({ length: 4 }, () => promoted.notify(raw, signed)),
  )
  assert.equal(
    money((await p.billing.wallet(uid)).balance) - beforePromotion,
    12_020_000n,
  )
  const promotionEntries = (await p.billing.entries(uid)).filter(
    (e) => e.amount === '10.010000' || e.amount === '2.010000',
  )
  assert.equal(promotionEntries.length, 2)
  assert(promotionEntries.some((e) => e.kind === 'recharge'))
  assert(promotionEntries.some((e) => e.kind === 'grant'))
  for (const amount of ['0.99', '1.001', '10000.01']) {
    await assert.rejects(promoted.create(uid, amount, randomUUID()))
  }
  for (const path of ['/wallet/pricing', '/payments/recharge-options']) {
    const response = await app.inject({ url: `/api/v1${path}`, headers })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.headers['cache-control'], 'no-store')
    assert(
      !/modelId|providerId|apiKey|keyCipher|updatedBy|revision/.test(
        response.body,
      ),
    )
    assert.equal((await app.inject({ url: `/api/v1${path}` })).statusCode, 401)
  }
  console.info(
    '✓ Recharge floor, immutable bonuses, separate credit entries and concurrent verified callbacks preserve exact balances',
  )
  const userEndpoints = [
    '/wallet',
    '/wallet/usage',
    '/wallet/entries',
    '/payments/orders',
  ]
  for (const path of userEndpoints) {
    const result = await app.inject({ url: `/api/v1${path}`, headers })
    assert.equal(result.statusCode, 200, result.body)
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.ok(
      !/model_config_id|prices_json|inputPrice|private-fixture|response_id/.test(
        result.body,
      ),
    )
    assert.equal((await app.inject({ url: `/api/v1${path}` })).statusCode, 401)
  }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/payments/orders',
        headers,
        payload: { amount: '10' },
      })
    ).statusCode,
    400,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/payments/orders',
        headers: { ...headers, 'idempotency-key': randomUUID() },
        payload: { amount: '10' },
      })
    ).statusCode,
    503,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhooks/wechat',
        payload: { fixture: true },
      })
    ).statusCode,
    503,
  )
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/session',
    headers: { 'x-admin-request': '1' },
    payload: { username: `billing_${adminId.slice(0, 8)}`, password: secret },
  })
  assert.equal(login.statusCode, 200, login.body)
  const cookie = (login.headers['set-cookie'] as string).split(';')[0]!
  const adminHeaders = { cookie, 'x-admin-request': '1' }
  const rechargeConfig = await app.inject({
    url: '/api/v1/admin/payments/recharge-options',
    headers: adminHeaders,
  })
  assert.equal(rechargeConfig.statusCode, 200, rechargeConfig.body)
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/admin/payments/recharge-options',
        headers,
      })
    ).statusCode,
    401,
  )
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/payments/recharge-options',
        headers: { cookie },
        payload: {
          presets: [{ amount: '10', bonusAmount: '0', enabled: true }],
          customEnabled: false,
          bonusRules: [],
          revision: 1,
        },
      })
    ).statusCode,
    403,
  )
  const searched = await app.inject({
    url: `/api/v1/admin/billing/users?search=${encodeURIComponent(a.user.username)}`,
    headers: adminHeaders,
  })
  assert.equal(searched.statusCode, 200, searched.body)
  assert.equal(searched.json().data.length, 1)
  assert.equal(searched.json().data[0].id, uid)
  const wildcard = await app.inject({
    url: '/api/v1/admin/billing/users?search=%25',
    headers: adminHeaders,
  })
  assert.ok(
    wildcard
      .json()
      .data.every(
        (u: { username: string, nickname: string }) =>
          u.username.includes('%') || u.nickname.includes('%'),
      ),
  )
  const directory = await app.inject({
    url: '/api/v1/admin/billing/users',
    headers: adminHeaders,
  })
  assert.equal(directory.statusCode, 200, directory.body)
  const adjusted = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/billing/users/${uid}`,
    headers: adminHeaders,
    payload: { mode: 'record_only', reason: 'route fixture' },
  })
  assert.equal(adjusted.statusCode, 200, adjusted.body)
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/billing/users/${uid}`,
        headers,
        payload: { mode: 'record_only', reason: 'forged' },
      })
    ).statusCode,
    403,
  )
  console.info(
    '✓ User APIs hide models; admin-only adjustments, disabled payments and callback boundaries are enforced',
  )
  const large = 9_007_199_254_740_995n
  await source.query(
    'UPDATE billing_wallets SET balance_micro=? WHERE user_id=?',
    [large.toString(), b.user.id],
  )
  await p.billing.grant(
    b.user.id,
    '0.000001',
    randomUUID(),
    'precision fixture',
    adminId,
  )
  assert.equal(
    (await p.billing.wallet(b.user.id)).balance,
    '9007199254.740996',
  )
  console.info(
    '✓ MySQL BIGINT balances remain exact beyond JavaScript Number precision',
  )
  // Ensure webhook signature verification receives exact raw bytes via Fastify.
  const withGateway = new PlatformService(source, undefined, gateway)
  const callbackApp = createApp({
    platform: withGateway,
    bills: createBillRepository(source),
    health: async () => ({ mysql: 'up', redis: 'disabled' }),
  })
  try {
    const result = await callbackApp.inject({
      method: 'POST',
      url: '/api/v1/payments/webhooks/wechat',
      headers: { ...signed, 'content-type': 'application/json' },
      payload: raw,
    })
    assert.equal(result.statusCode, 200, result.body)
  } finally {
    await callbackApp.close()
  }
} finally {
  await app.close()
  await new Promise<void>((r) => remote.close(() => r()))
  await cleanupUsers(source, users)
  await source.query('DELETE FROM admin_sessions WHERE admin_id=?', [adminId])
  await source.query('DELETE FROM admin_users WHERE id=?', [adminId])
  await source.destroy()
}
