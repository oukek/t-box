import type { ConfigurationSnapshot } from '@t-box/shared'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ProviderConcurrency } from '../src/billing/concurrency.js'
import { prices } from '../src/billing/money.js'
import { MeteredChatProvider } from '../src/billing/provider.js'
import { BillingService } from '../src/billing/service.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const independent = await createDataSource().initialize()
const users: string[] = []
const providerId = randomUUID()
const config: ConfigurationSnapshot = { revision: 1, values: { 'ai.cost.taskYuan': 0.01, 'ai.cost.userDailyYuan': 0.02, 'ai.cost.platformDailyYuan': 0, 'ai.provider.concurrency': 1, 'ai.provider.queueTimeoutMs': 1000 } }
const billing = new BillingService(source, { snapshot: async () => config })
const pools = [new ProviderConcurrency(source), new ProviderConcurrency(independent)]
const price = prices({ inputPrice: '1', outputPrice: '1', imagePrice: '0.01' })
try {
  const platform = new PlatformService(source)
  for (let i = 0; i < 2; i++) {
    const login = await platform.identity.register({ username: `budget_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '成本测试' }, 'cost-control-fixture')
    users.push(login.user.id)
    await source.query('INSERT INTO billing_wallets(user_id,mode) VALUES(?,\'record_only\')', [login.user.id])
  }
  const begin = (userId: string, taskId = randomUUID(), reserve = 10000n) => billing.begin({ id: randomUUID(), userId, taskId, reserve, prices: price, modelId: providerId, kind: 'conversation' })
  const taskId = randomUUID()
  const competing = await Promise.allSettled([begin(users[0]!, taskId), begin(users[0]!, taskId)])
  assert.equal(competing.filter((entry) => entry.status === 'fulfilled').length, 1, 'Task budget is reserved atomically')
  const failure = competing.find((entry) => entry.status === 'rejected') as PromiseRejectedResult
  assert.equal(failure.reason.code, 'AI_COST_LIMIT')
  await begin(users[0]!)
  await assert.rejects(begin(users[0]!), { code: 'AI_COST_LIMIT' })
  assert.equal((await billing.wallet(users[0]!)).balance, '0.000000', 'Record-only costs do not debit')
  assert.equal((await billing.wallet(users[0]!)).reserved, '0.000000')
  const [{ total }] = await source.query('SELECT SUM(cost_reserved_micro) AS total FROM billing_usage WHERE user_id=?', [users[0]])
  assert.equal(BigInt(total), 20000n, 'Record-only still reserves platform cost')
  config.values['ai.cost.platformDailyYuan'] = 0.02
  await assert.rejects(begin(users[1]!), { code: 'AI_COST_LIMIT' })
  config.values['ai.cost.platformDailyYuan'] = 0
  const [unknown] = await source.query('SELECT id FROM billing_usage WHERE user_id=? LIMIT 1', [users[0]])
  await billing.uncertain(users[0]!, unknown.id)
  await billing.release(users[0]!, unknown.id, randomUUID(), 'fixture-only release')
  await assert.rejects(begin(users[0]!), { code: 'AI_COST_LIMIT' }, 'Waiving an unknown charge cannot erase upstream cost')

  // Actual low usage frees the unused cost estimate. A title remains free to a charge-mode wallet.
  await source.query('UPDATE billing_wallets SET mode=\'charge\' WHERE user_id=?', [users[1]])
  const title = new MeteredChatProvider({ mode: 'openai', async next() {
    throw new Error('unused')
  }, async title(input) {
    await input.onUsage?.({ inputTokens: 10, outputTokens: 10, responseId: 'title-fixture' })
    return '免费标题'
  } }, billing, providerId, price)
  await title.title({ text: 'fixture', signal: new AbortController().signal, execution: { userId: users[1]!, taskId: randomUUID(), operationId: randomUUID() } })
  const [overhead] = await source.query('SELECT fee_micro,charged_micro FROM billing_usage WHERE user_id=? AND purpose=\'title\'', [users[1]])
  assert.equal(BigInt(overhead.fee_micro), 20n)
  assert.equal(BigInt(overhead.charged_micro), 0n)

  let active = 0
  let max = 0
  const signal = new AbortController().signal
  await Promise.all(Array.from({ length: 5 }, (_, index) => pools[index % 2]!.run(providerId, signal, { ...config, values: { ...config.values, 'ai.provider.queueTimeoutMs': 5000 } }, async () => {
    active++
    max = Math.max(max, active)
    await new Promise((resolve) => setTimeout(resolve, 25))
    active--
  })))
  assert.equal(max, 1, 'Separate process pools respect the shared provider limit')
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => entered = resolve)
  const pending = pools[0]!.run(providerId, signal, config, async () => {
    entered()
    await new Promise<void>((resolve) => release = resolve)
  })
  await started
  const controller = new AbortController()
  const cancelled = pools[1]!.run(providerId, controller.signal, config, async () => assert.fail('Cancelled queue must not invoke a provider'))
  controller.abort()
  await assert.rejects(cancelled)
  await assert.rejects(pools[1]!.run(providerId, signal, config, async () => assert.fail('Full pool must not invoke a provider')), { code: 'PROVIDER_BUSY' })
  release()
  await pending
  assert.equal((await source.query('SELECT id FROM ai_provider_leases WHERE provider_id=?', [providerId])).length, 0)
  console.log('Cost control integration passed: atomic task/user/platform budgets, record-only cost, unknown usage retention, free title overhead, shared concurrency, cancellation and queue limits')
} finally {
  await source.query('DELETE FROM ai_provider_leases WHERE provider_id=?', [providerId])
  await source.query('DELETE FROM ai_provider_pools WHERE provider_id=?', [providerId])
  await cleanupUsers(source, users)
  await independent.destroy()
  await source.destroy()
}
