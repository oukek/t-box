/** Disposable MySQL + fake local OpenAI endpoint only; never invoke a configured external provider. */
import type { ConfigurationSnapshot } from '@t-box/shared'
import type { ProviderInput } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { createVault, hashPassword } from '../src/admin/crypto.js'
import { DatabaseChatProvider } from '../src/admin/runtime.js'
import { ConfigurationService } from '../src/admin/service.js'
import { AdminStore } from '../src/admin/store.js'
import { modelRequest } from '../src/agent/model-retry.js'
import { createApp } from '../src/app.js'
import { ProviderConcurrency } from '../src/billing/concurrency.js'
import { BillingPricingService } from '../src/billing/pricing.js'
import { BillingService } from '../src/billing/service.js'
import { ApplicationChatService } from '../src/bootstrap/chat.js'
import { ConfigurationCache } from '../src/configuration/cache.js'
import { createDataSource } from '../src/db/data-source.js'
import { ModelCallAudit } from '../src/models/audit.js'
import { ModelOperations } from '../src/operations/model-calls.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

if (!/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('This test requires a disposable t_box_ci / t_box_test_* database')
}
const source = await createDataSource().initialize()
const independent = await createDataSource().initialize()
const store = new AdminStore(source)
const vault = createVault(randomBytes(32))
const cacheEntries = new Map<string, string>()
const cache = new ConfigurationCache({ isReady: true, async get(key) {
  return cacheEntries.get(key) ?? null
}, async set(key, value) {
  cacheEntries.set(key, value)
} }, 'model-pools-fixture')
const service = new ConfigurationService(store, vault, cache)
const second = new ConfigurationService(new AdminStore(independent), vault, cache)
const original = await store.settings()
const providers: string[] = []
const models: string[] = []
const users: string[] = []
const apiKey = 'model-pool-fixture-key-keep-private'
const snapshot: ConfigurationSnapshot = { revision: 1, values: { 'ai.provider.concurrency': 8, 'ai.provider.queueTimeoutMs': 3000, 'ai.cost.taskYuan': 0, 'ai.cost.userDailyYuan': 0, 'ai.cost.platformDailyYuan': 0 } }
const billing = new BillingService(source, { snapshot: async () => snapshot })
const limits = [new ProviderConcurrency(source), new ProviderConcurrency(independent)]
const database = new DatabaseChatProvider(service, billing, limits[0])
const platform = new PlatformService(source, service)
const app = createApp({ platform, administration: service, bills: {} as any, health: async () => ({ mysql: 'up', redis: 'disabled' }) })
let adminId = ''
let rejectNext = false
let rejectImage = false
const requested: string[] = []
const chatBodies: any[] = []
let chat: ApplicationChatService | undefined
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=', 'base64')
const remote = createServer(async (req, res) => {
  assert.equal(req.headers.authorization, `Bearer ${apiKey}`)
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: ['fixture-a', 'fixture-b', 'fixture-c', 'fixture-image', 'fixture-image-b'].map((id) => ({ id, object: 'model' })) }))
    return
  }
  requested.push(body.model)
  if (rejectNext || (rejectImage && req.url === '/v1/images/generations')) {
    rejectNext = false
    res.writeHead(429, { 'content-type': 'application/json', 'x-request-id': 'fixture-error-request' })
    res.end(JSON.stringify({ error: { message: `fixture rate limited; echo ${apiKey}`, type: 'rate_limit_error', code: 'rate_limit_exceeded' } }))
    return
  }
  if (req.url === '/v1/images/generations') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
    return
  }
  assert.equal(req.url, '/v1/chat/completions')
  chatBodies.push(body)
  const id = `fixture-response-${randomUUID()}`
  res.setHeader('Content-Type', 'text/event-stream')
  for (const chunk of [
    { choices: [{ index: 0, delta: { role: 'assistant', content: '2' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, prompt_tokens_details: { cached_tokens: 4 }, completion_tokens_details: { reasoning_tokens: 1 } } },
  ]) {
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: body.model, ...chunk })}\n\n`)
  }
  res.end('data: [DONE]\n\n')
})
await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${(remote.address() as { port: number }).port}/v1`
try {
  for (let index = 0; index < 2; index++) {
    providers.push(await service.saveProvider({ name: `Pool provider ${index}`, baseUrl: url, apiKey, enabled: true, maxConcurrency: index ? 2 : 2 }))
  }
  const defineModel = async (providerId: string, modelId: string, vision = false, purpose = 'conversation', price = '1') => {
    const id = await service.saveModel({ providerId, modelId, name: `Pool ${modelId}`, enabled: true, purpose, supportsVision: vision, invocationMode: purpose === 'image' ? 'images' : 'chat_completions', inputPrice: price, outputPrice: '2', imagePrice: '0.01', maxConcurrency: 1 })
    models.push(id)
    return id
  }
  const a = await defineModel(providers[0]!, 'fixture-a')
  const b = await defineModel(providers[0]!, 'fixture-b', true, 'conversation', '3')
  const c = await defineModel(providers[1]!, 'fixture-c')
  const image = await defineModel(providers[1]!, 'fixture-image', false, 'image')
  const imageB = await defineModel(providers[0]!, 'fixture-image-b', false, 'image')
  await service.selectModel({ modelIds: [a, b, c], imageModelIds: [image, imageB] })
  assert.deepEqual((await store.settings()).modelIds, [a, b, c])
  await assert.rejects(service.selectModel({ modelIds: [a, a] }), { code: 'INVALID_CONFIG' })
  await assert.rejects(service.selectModel({ modelIds: [image] }))
  await assert.rejects(service.remove('models', b))
  await assert.rejects(service.saveProvider({ name: 'Cannot disable pool member', baseUrl: url, enabled: false }, providers[1]))
  assert.equal((await store.provider(providers[0]!)).maxConcurrency, 2)
  await service.saveProvider({ name: 'Pool provider 0', baseUrl: url, enabled: true }, providers[0])
  assert.equal((await store.provider(providers[0]!)).maxConcurrency, 2, 'Legacy provider edits preserve the configured limit')
  for (let index = 0; index < 4; index++) {
    await service.runtime('conversation', { peek: true })
  }
  const routing = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? service : second).runtime()))
  for (const id of [a, b, c]) {
    assert.equal(routing.filter((model) => model?.billingModelId === id).length, 4, 'Separate processes fairly rotate idle models')
  }
  const vision = await second.runtime('conversation', { supportsVision: true })
  assert.equal(vision?.billingModelId, b)
  const pinned = await service.runtime('conversation', { configurationKey: routing[0]!.configurationKey })
  assert.equal(pinned?.configurationKey, routing[0]!.configurationKey)
  for (let index = 0; index < 3; index++) {
    assert.equal((await service.runtime('conversation', { preferredConfigurationKey: pinned!.configurationKey }))?.billingModelId, pinned!.billingModelId, 'Healthy conversations retain model/cache affinity')
  }
  await service.selectModel({ modelIds: [b, c] })
  await assert.rejects(service.runtime('conversation', { configurationKey: `${a}:old` }), { code: 'TASK_MODEL_CHANGED' })
  assert.notEqual((await service.runtime('conversation', { preferredConfigurationKey: `${a}:old` }))?.billingModelId, a, 'A new task can leave an unavailable preferred model without weakening strict resume pinning')
  await service.selectModel({ modelIds: [a, b, c] })
  const price = await new BillingPricingService(source).schedule()
  assert.deepEqual(price.conversation, { inputPrice: '3.000000', outputPrice: '2.000000', minInputPrice: '1.000000' })
  assert.equal(JSON.stringify(price).includes('fixture'), false, 'Public prices never reveal models or providers')
  assert.equal([...cacheEntries.values()].some((value) => value.includes(apiKey)), false, 'Redis contains encrypted credentials only')

  let active = 0
  let peak = 0
  const perModel = new Map<string, number>()
  const peaks = new Map<string, number>()
  const pending = Array.from({ length: 8 }, (_, index) => {
    const id = index % 2 ? a : b
    return limits[index % 2]!.run(providers[0]!, new AbortController().signal, snapshot, async () => {
      active++
      peak = Math.max(peak, active)
      perModel.set(id, (perModel.get(id) || 0) + 1)
      peaks.set(id, Math.max(peaks.get(id) || 0, perModel.get(id)!))
      await new Promise((resolve) => setTimeout(resolve, 35))
      active--
      perModel.set(id, perModel.get(id)! - 1)
    }, { id, maxConcurrency: 1, providerConcurrency: 2 })
  })
  await Promise.all(pending)
  assert.equal(peak, 2)
  assert.equal(peaks.get(a), 1)
  assert.equal(peaks.get(b), 1)
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => entered = resolve)
  const occupied = limits[0]!.run(providers[0]!, new AbortController().signal, snapshot, async () => {
    entered()
    await new Promise<void>((resolve) => release = resolve)
  }, { id: a, maxConcurrency: 1 })
  await started
  const balanced = await service.runtime('conversation', { preferredConfigurationKey: `${a}:old` })
  assert.notEqual(balanced?.billingModelId, a, 'Busy model is not assigned while idle alternatives exist')
  const abort = new AbortController()
  const queued = limits[1]!.run(providers[0]!, abort.signal, snapshot, async () => assert.fail('Cancelled model queue must not execute'), { id: a, maxConcurrency: 1 })
  abort.abort()
  await assert.rejects(queued)
  release()
  await occupied

  const login = await platform.identity.register({ username: `modelpool_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '模型池审计测试' }, 'model-pool-fixture')
  users.push(login.user.id)
  const actor = await platform.identity.authenticate(login.token)
  await source.query('INSERT INTO billing_wallets(user_id,mode) VALUES(?,\'record_only\')', [actor.user.id])
  const taskId = randomUUID()
  const assistantId = randomUUID()
  const conversationId = randomUUID()
  const taskCheckpoint = { assistantId, session: { messages: [{ id: randomUUID(), role: 'user', content: '1+1=?' }, { id: assistantId, role: 'assistant', content: '' }] }, secret: 'private-checkpoint-token' }
  await platform.tasks.create(actor, taskId, conversationId, 'fixture-request', taskCheckpoint, 'fixture')
  const owner = randomUUID()
  await platform.tasks.claim(actor, taskId, owner)
  await service.selectModel({ modelIds: [a, b] })
  const provider = await database.forRun({ configurationKey: (await service.runtime('conversation', { peek: true }))!.configurationKey })
  rejectNext = true
  const input: ProviderInput = { history: [{ role: 'user', content: '1+1=?' }], instructions: 'Answer briefly', localDate: '2026-10-15', tools: [], signal: new AbortController().signal, onDelta() {}, execution: { userId: actor.user.id, taskId, messageId: assistantId, operationId: randomUUID(), purpose: 'response' }, configuration: snapshot }
  let retries = 0
  await modelRequest('next', input, provider.next.bind(provider), { records: {}, save: async () => {}, onRetry: async () => {
    retries++
  }, onUsage: async () => {}, wait: async () => {} })
  assert.equal(retries, 1)
  const operations = new ModelOperations(source)
  const recorded = await operations.forTask(taskId)
  assert.equal(recorded.length, 2)
  assert.deepEqual(recorded.map((call) => call.retryIndex).sort(), [0, 1])
  assert.equal(new Set(recorded.map((call) => call.logicalId)).size, 1)
  assert.equal(new Set(recorded.map((call) => call.id)).size, 1, 'Retry remains on the pinned model')
  const failed = recorded.find((call) => call.status === 'failed')!
  const succeeded = recorded.find((call) => call.status === 'succeeded')!
  assert.equal(failed.billingStatus, 'review', 'Unknown upstream usage must not be labelled free')
  assert.equal(succeeded.inputTokens, 12)
  assert.equal(succeeded.outputTokens, 3)
  assert.equal(succeeded.cachedInputTokens, 4)
  assert.equal(succeeded.reasoningTokens, 1)
  assert.equal(succeeded.charged, '0.000000')
  assert.ok(Number(succeeded.cost) > 0)
  const failure = await operations.call(failed.callId)
  assert.equal(failure.providerRequestId, 'fixture-error-request')
  assert.ok(JSON.stringify(failure.diagnostics).includes('fixture rate limited'))
  assert.equal(JSON.stringify(failure).includes(apiKey), false)
  assert.equal(failure.userError!.includes('echo'), false, 'The end-user error never exposes upstream bodies')
  const row = (await operations.tasks({ userId: actor.user.id, modelId: succeeded.id, providerId: succeeded.providerId })).items[0]!
  assert.equal(row.calls, 2)
  assert.equal(row.retryCount, 1)
  assert.equal(row.unresolved, 1)
  assert.equal(row.cost, succeeded.cost)
  assert.equal((await operations.tasks({ search: login.user.username })).total, 1)
  assert.equal((await operations.calls({ userId: actor.user.id, status: 'failed' })).total, 1)
  assert.equal((await operations.calls({ userId: actor.user.id, page: '1', pageSize: '1' })).items.length, 1)
  await platform.tasks.finish(taskId, owner, 'completed', undefined, undefined, false, { id: assistantId, role: 'assistant', content: 'Final original answer', toolCalls: [], createdAt: new Date().toISOString() })
  const detail = await platform.operations.task(taskId)
  assert.equal((detail.output as any).content, 'Final original answer')
  assert.equal(JSON.stringify(detail).includes('private-checkpoint-token'), false)

  // Images use their own selected pool, independently audit success/failure and never auto-retry an external side effect.
  const imageTool = platform.images.forRun(actor, new AbortController().signal, taskId)
  const countBefore = requested.length
  const generated = await imageTool({ prompt: 'A small test image' })
  assert.equal(generated.resources[0]!.source, 'generated')
  assert.ok(['fixture-image', 'fixture-image-b'].includes(requested.at(-1)!))
  rejectImage = true
  await assert.rejects(imageTool({ prompt: 'A failing test image' }), { code: 'IMAGE_PROVIDER_FAILED' })
  assert.equal(requested.length - countBefore, 2)
  rejectImage = false
  const imageCalls = (await operations.forTask(taskId)).filter((call) => call.purpose === 'image')
  assert.equal(imageCalls.length, 2)
  assert.equal(imageCalls.find((call) => call.status === 'succeeded')?.images, 1)
  assert.ok((await operations.call(imageCalls.find((call) => call.status === 'failed')!.callId)).diagnostics)
  const cool = await source.query('SELECT failures,cooldown_until>UTC_TIMESTAMP(3) AS cooling FROM ai_model_routing WHERE model_id=?', [imageCalls[0]!.id])
  assert.equal(Number(cool[0].cooling), 1)
  assert.notEqual((await service.runtime('image'))?.billingModelId, imageCalls[0]!.id, 'New tasks avoid cooling models')

  // Leases expire after a process dies, producing an explicit interrupted state.
  const expiredId = randomUUID()
  const audit = new ModelCallAudit(source)
  const metadata = (await service.runtime('conversation', { peek: true }))!
  await audit.begin({ userId: actor.user.id, operationId: expiredId }, metadata, 'next', {}, 4096)
  await source.query('UPDATE ai_model_calls SET lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?', [expiredId])
  await audit.recover()
  assert.equal((await operations.call(expiredId)).status, 'interrupted')

  // Administrator session protects every list/detail endpoint, with no-store and no checkpoint/credential disclosure.
  adminId = await store.createUser(`pool-admin-${randomUUID().slice(0, 8)}`, await hashPassword('test123'))
  const [admin] = await source.query('SELECT username FROM admin_users WHERE id=?', [adminId])
  const auth = await app.inject({ method: 'POST', url: '/api/v1/admin/session', headers: { 'x-admin-request': '1' }, payload: { username: admin.username, password: 'test123' } })
  assert.equal(auth.statusCode, 200)
  const cookie = String(auth.headers['set-cookie']).split(';')[0]!
  for (const path of ['/operations/tasks', '/operations/calls', `/operations/calls/${failed.callId}`, `/operations/tasks/${taskId}`]) {
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin' + path })).statusCode, 401)
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin' + path, headers: { cookie } })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.headers['cache-control'], 'no-store')
    assert.equal(response.body.includes(apiKey), false)
    assert.equal(response.body.includes('private-checkpoint-token'), false)
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/operations/calls?pageSize=500', headers: { cookie } })).statusCode, 400)
  // Pre-upgrade billing rows remain visible and filterable alongside the new call audit.
  const legacyTaskId = randomUUID()
  await platform.tasks.create(actor, legacyTaskId, randomUUID(), 'legacy-fixture', {}, 'fixture')
  const legacyUsageId = randomUUID()
  const legacyMetadata = (await service.runtime('conversation', { configurationKey: `${c}:legacy`, peek: true }).catch(() => null))
  // Model c is intentionally outside the current pool; its retained config still identifies old billing rows.
  assert.equal(legacyMetadata, null)
  await billing.begin({ id: legacyUsageId, userId: actor.user.id, taskId: legacyTaskId, modelId: c, prices: { inputPrice: '1', outputPrice: '2', imagePrice: '0' }, kind: 'conversation', reserve: 1000n })
  await billing.settle(actor.user.id, legacyUsageId, { inputTokens: 10, outputTokens: 1 })
  const legacyRows = await operations.tasks({ userId: actor.user.id, modelId: c, providerId: providers[1] })
  assert.equal(legacyRows.total, 1)
  assert.equal(legacyRows.items[0]!.calls, 1)
  assert.equal(legacyRows.items[0]!.models[0]!.id, c)
  // A later unaudited legacy charge and existing audited calls must not multiply or hide one another.
  const extra = randomUUID()
  await billing.begin({ id: extra, userId: actor.user.id, taskId, modelId: c, prices: { inputPrice: '1', outputPrice: '2', imagePrice: '0' }, kind: 'conversation', reserve: 1000n })
  await billing.settle(actor.user.id, extra, { inputTokens: 10, outputTokens: 1 })
  assert.equal((await operations.tasks({ taskId })).items[0]!.calls, 5, 'Two conversation calls, two image calls and one historical billing row')

  // End-to-end socket protocol: a conversation stays on its healthy model;
  // an explicit pool change switches the next task without losing portable history.
  await service.selectModel({ modelIds: [a, b] })
  chat = new ApplicationChatService({ platform, provider: database, bills: createBillRepository(source) })
  const events: any[] = []
  const connection = chat.connect((event) => events.push(structuredClone(event)))
  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 8000
    while (!check()) {
      if (Date.now() >= deadline) {
        throw new Error('Socket pool test timed out')
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  await connection.receive({ type: 'session.open', authToken: login.token })
  await until(() => events.some((event) => event.type === 'session.ready'))
  const socketTasks: string[] = []
  for (const text of ['First tiny question', 'Continue using the previous answer']) {
    const requestId = randomUUID()
    await connection.receive({ type: 'message.send', requestId, text, localDate: '2026-10-15' })
    await until(() => events.some((event) => event.type === 'run.finished' && event.snapshot.messages.some((message: any) => message.role === 'assistant' && message.content === '2') && events.some((started) => started.type === 'run.started' && started.run.id === event.runId && started.run.requestId === requestId)))
    const started = events.find((event) => event.type === 'run.started' && event.run.requestId === requestId)
    socketTasks.push(started.run.id)
  }
  const socketModels = await Promise.all(socketTasks.map((id) => operations.forTask(id)))
  assert.ok(socketModels.every((rows) => rows.some((row) => row.status === 'succeeded')))
  assert.equal(socketModels[0]![0]!.id, socketModels[1]![0]!.id, 'The same conversation keeps its model and cached prefix')
  const alternative = socketModels[0]![0]!.id === a ? b : a
  await service.selectModel({ modelIds: [alternative] })
  const switchedId = randomUUID()
  await connection.receive({ type: 'message.send', requestId: switchedId, text: 'Continue after changing the model pool', localDate: '2026-10-15' })
  await until(() => events.some((event) => event.type === 'run.finished' && events.some((started) => started.type === 'run.started' && started.run.id === event.runId && started.run.requestId === switchedId)))
  const switchedTask = events.find((event) => event.type === 'run.started' && event.run.requestId === switchedId).run.id
  socketTasks.push(switchedTask)
  assert.equal((await operations.forTask(switchedTask))[0]!.id, alternative)
  assert.ok(chatBodies.some((body) => body.messages.filter((message: any) => message.role === 'user').length >= 3 && body.messages.some((message: any) => message.role === 'assistant' && message.content === '2')), 'A switched model retains the earlier answers and questions')
  for (const id of socketTasks) {
    assert.equal((await platform.operations.task(id)).status, 'completed')
  }
  await chat.close()
  chat = undefined
  await service.selectModel({ modelIds: [b] })
  await service.remove('models', a)
  assert.equal((await operations.call(succeeded.callId)).name, succeeded.name, 'Audit identities survive model deletion')
  await service.selectModel({ modelIds: [] })
  assert.equal((await database.forRun()).mode, 'unconfigured')
  console.log('Model pools integration passed: multi-process load-aware rotation, vision/pinning, two-tier hard concurrency, cancellation, encrypted cache, price ranges, retries, IO/errors/fees audit, images, expiry, task snapshots and admin authorization')
} finally {
  await chat?.close()
  await app.close()
  await service.selectModel(original)
  await cleanupUsers(source, users)
  for (const id of models) {
    await source.query('DELETE FROM ai_models WHERE id=?', [id])
  }
  for (const id of providers) {
    await source.query('DELETE FROM ai_provider_leases WHERE provider_id=?', [id])
    await source.query('DELETE FROM ai_provider_pools WHERE provider_id=?', [id])
    await source.query('DELETE FROM ai_providers WHERE id=?', [id])
  }
  for (const id of models) {
    await source.query('DELETE FROM ai_model_routing WHERE model_id=?', [id])
  }
  if (adminId) {
    await source.query('DELETE FROM admin_users WHERE id=?', [adminId])
  }
  await new Promise<void>((resolve) => remote.close(() => resolve()))
  await independent.destroy()
  await source.destroy()
}
