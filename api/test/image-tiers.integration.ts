/** Uses a disposable database and a local fake Images API. No paid model calls. */
import type { ImageTier } from '@t-box/shared'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'mysql2/promise'
import sharp from 'sharp'
import { createVault } from '../src/admin/crypto.js'
import { ConfigurationService } from '../src/admin/service.js'
import { AdminStore } from '../src/admin/store.js'
import { getConfig } from '../src/config.js'
import { ConfigurationCache } from '../src/configuration/cache.js'
import { createDataSource } from '../src/db/data-source.js'
import { initializeDatabase } from '../src/db/initialize.js'
import { databaseSchemas } from '../src/db/schema/index.js'
import { IdentityService } from '../src/identity/service.js'
import { ModelOperations } from '../src/operations/model-calls.js'
import { ImageTools } from '../src/resources/images.js'
import { ResourceService } from '../src/resources/service.js'

const config = getConfig().mysql
const name = `t_box_test_image_tiers_${randomUUID().replaceAll('-', '')}`
const { database: _database, ...options } = config
const admin = await createConnection(options)
const source = createDataSource({ ...config, database: name })
const directory = await mkdtemp(join(tmpdir(), 'tbox-image-tiers-'))
const requests: { model: string, size: string }[] = []
const remote = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.end(JSON.stringify({ data: ['fixture-1k', 'fixture-multi', 'fixture-4k'].map((id) => ({ id })) }))
    return
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk))
  }
  const body: { model: string, size: string } = JSON.parse(Buffer.concat(chunks).toString())
  requests.push(body)
  const side = Number(body.size.split('x')[0])
  const png = await sharp({ create: { width: side, height: side, channels: 3, background: '#ccddee' } }).png().toBuffer()
  res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
})
let created = false
try {
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  created = true
  await source.initialize()
  await initializeDatabase(source, databaseSchemas)
  await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve))
  const address = remote.address()
  assert.ok(address && typeof address !== 'string')
  const cached = new Map<string, string>()
  const service = new ConfigurationService(new AdminStore(source), createVault(randomBytes(32)), new ConfigurationCache({
    isReady: true,
    get: async (key) => cached.get(key) ?? null,
    async set(key, value) {
      cached.set(key, value)
    },
  }, name))
  const providerId = await service.saveProvider({ name: 'Local image fixture', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fixture-only', enabled: true })
  const models = new Map<ImageTier, string>()
  const model = (imageTiers: unknown, modelId = 'fixture-multi') => ({ providerId, modelId, name: modelId, purpose: 'image', imageTiers, enabled: true, imagePrice: '0.1' })
  const oneKId = await service.saveModel(model(['1k'], 'fixture-1k'))
  const multiInput = { ...model(['2k', '4k']), imagePrices: { '2k': '0.2', '4k': '0.4' } }
  const multiId = await service.saveModel(multiInput)
  const fourKOnlyId = await service.saveModel(model(['4k'], 'fixture-4k'))
  models.set('1k', oneKId)
  models.set('2k', multiId)
  models.set('4k', multiId)
  for (const invalid of [[], ['8k'], ['1k', '1k'], null, '2k']) {
    await assert.rejects(service.saveModel(model(invalid)), { code: 'IMAGE_TIER_INVALID' })
  }
  await assert.rejects(service.saveModel(multiInput), { code: 'ER_DUP_ENTRY' })
  await service.selectModel({ imageModelIds: [oneKId, multiId] })
  const returned = await service.store.models()
  assert.equal(returned.length, 3)
  assert.deepEqual(returned.find((row) => row.id === multiId)?.imageTiers, ['2k', '4k'])
  assert.deepEqual(returned.find((row) => row.id === multiId)?.imagePrices, { '2k': '0.200000', '4k': '0.400000' })
  for (const tier of ['1k', '2k', '4k'] as const) {
    const runtime = await service.runtime('image', { imageTier: tier })
    assert.equal(runtime?.billingModelId, models.get(tier))
    assert.equal(runtime?.imageTier, tier)
    assert.ok(returned.find((row) => row.id === runtime?.billingModelId)?.imageTiers?.includes(tier))
    assert.equal(runtime?.prices.imagePrice, tier === '4k' ? '0.400000' : tier === '2k' ? '0.200000' : '0.100000')
  }
  assert.equal((await service.runtime('image'))?.imageTier, '1k')
  const oneK = await service.runtime('image', { imageTier: '1k' })
  await assert.rejects(service.runtime('image', { imageTier: '4k', configurationKey: oneK!.configurationKey }), { code: 'TASK_MODEL_CHANGED' })
  // Changing capabilities/quotes invalidates cached candidates and prices.
  await service.saveModel({ ...model(['2k']), imagePrices: { '2k': '0.25' } }, multiId)
  await assert.rejects(service.runtime('image', { imageTier: '4k' }), { code: 'IMAGE_TIER_UNAVAILABLE' })
  assert.equal((await service.runtime('image', { imageTier: '2k' }))?.prices.imagePrice, '0.250000')
  await service.saveModel(multiInput, multiId)
  assert.equal((await service.runtime('image', { imageTier: '4k' }))?.prices.imagePrice, '0.400000')

  const identity = new IdentityService(source, undefined, 'internal')
  const login = await identity.register({ username: 'tier_fixture', password: 'test123' }, 'fixture')
  const actor = await identity.authenticate(login.token)
  const resources = new ResourceService(source, directory)
  const tools = new ImageTools(resources, service)
  const run = tools.forRun(actor, new AbortController().signal)
  let resourceId = ''
  // Validation selects the same tier as execution, and switching tiers within a
  // single task must not reuse the first selected model.
  for (const tier of ['1k', '4k', '2k', '1k'] as const) {
    const args = tier === '1k' ? { prompt: 'Local fixture' } : { prompt: 'Local fixture', tier }
    await run.prepare(args)
    const result = await run(args)
    assert.equal(result.resources.length, 1)
    resourceId = result.resources[0]!.id
    const stored = await resources.bytes(actor, result.resources[0]!.id)
    assert.equal((await sharp(stored.bytes).metadata()).width, tier === '4k' ? 4096 : tier === '2k' ? 2048 : 1024)
  }
  assert.deepEqual(requests.map((row) => row.size), ['1024x1024', '4096x4096', '2048x2048', '1024x1024'])
  const calls = (await new ModelOperations(source).calls({ userId: actor.user.id })).items
  assert.deepEqual(calls.map((row) => row.id).sort(), [models.get('1k'), models.get('1k'), models.get('2k'), models.get('4k')].sort())

  // Cache invalidation and exact matching: a 2K/4K-only pool must not silently serve
  // the default 1K request. Reject before any provider call or billing starts.
  await service.selectModel({ imageModelIds: [fourKOnlyId] })
  assert.equal((await service.runtime('image', { imageTier: '4k' }))?.prices.imagePrice, '0.100000', 'A missing tier override uses the common procurement quote')
  await service.selectModel({ imageModelIds: [multiId] })
  assert.equal((await service.runtime('image', { imageTier: '2k' }))?.billingModelId, multiId)
  assert.equal((await service.runtime('image', { imageTier: '4k' }))?.billingModelId, multiId)
  const before = requests.length
  await assert.rejects(service.runtime('image'), { code: 'IMAGE_TIER_UNAVAILABLE' })
  const freshRun = tools.forRun(actor, new AbortController().signal)
  await assert.rejects(freshRun({ prompt: 'No compatible default model' }), { code: 'IMAGE_TIER_UNAVAILABLE' })
  assert.equal(requests.length, before)
  // A failed preparation is not cached forever; adding a matching pool recovers.
  await service.selectModel({ imageModelIds: [oneKId, multiId] })
  const recovered = await freshRun.prepare({ prompt: 'Recovered default' })
  assert.equal(recovered.config.billingModelId, models.get('1k'))
  const edit = await freshRun.prepare({ prompt: 'Edit fixture', resourceIds: [resourceId], tier: '2k' }, true)
  assert.equal(edit.config.billingModelId, models.get('2k'))
  console.info('Image tiers: multi-select persistence/validation, per-tier procurement prices, cache invalidation, exact capability routing, same-task tier changes, audit attribution and default 1K passed.')
} finally {
  if (remote.listening) {
    remote.closeAllConnections()
    await new Promise<void>((resolve) => remote.close(() => resolve()))
  }
  if (source.isInitialized) {
    await source.destroy()
  }
  if (created) {
    await admin.query(`DROP DATABASE \`${name}\``)
  }
  await admin.end()
  await rm(directory, { recursive: true, force: true })
}
