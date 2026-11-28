import type { BackendInvocation, LifecycleRequest } from '@t-box/app-contracts'
import type {
  Creation,
  WorkspaceHeader,
  WorkspacePatch,
  WorkspaceState,
} from '@t-box/shop-tools-contracts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  defaultConfig,
  metadataOf,
  newRow,
  newSheet,
  optimizationSlots,
} from '@t-box/shop-tools-core'
import { ShopCatalog, shopToolsSchema, ShopToolsService } from '@t-box/shop-tools-server'
import mysql from 'mysql2/promise'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { extendDatabase } from '../src/db/extensions.js'
import { assertDisposableDatabase } from './fixtures.js'

const database = `t_box_test_shop_${randomUUID().replaceAll('-', '')}`
assertDisposableDatabase(database)
const config = getConfig().mysql
const control = await mysql.createConnection({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  connectTimeout: 5000,
})
// native-sql: isolated test database DDL;
// the random guarded name never targets an application database.
await control.query(
  `CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
)
const source = createDataSource({ ...config, database })
try {
  await source.initialize()
  const runner = source.createQueryRunner()
  await runner.connect()
  try {
    assert.equal(await extendDatabase(runner, [shopToolsSchema]), 5)
    assert.equal(await extendDatabase(runner, [shopToolsSchema]), 0)
  } finally {
    await runner.release()
  }
  assert.ok(
    source.entityMetadatas
      .filter((m) => m.tableName.startsWith('shop_tools_'))
      .every((m) => m.foreignKeys.length === 0),
  )
  let textCalls = 0
  let catalogTextCalls = 0
  let imageAttempts = 0
  const service = new ShopToolsService(source, () => ({
    async catalogText(input) {
      catalogTextCalls++
      return Object.fromEntries([...input.slots].reverse().map((s) => [s.id, 'Translated ' + s.text]))
    },
    async catalogImage() {
      if (++imageAttempts === 1) {
        throw new Error('图片失败')
      }
      return 'generated-file'
    },
    async catalogPreview(id, authorize) {
      await authorize(id)
      return { mime: 'image/webp', base64: 'test' }
    },
    async text() {
      textCalls++
      return { title: 'Travel cup' }
    },
    async image() {
      throw new Error('测试图片服务失败')
    },
  }))
  const subject = 'a'.repeat(64)
  const other = 'b'.repeat(64)
  const releaseId = 'shop-tools-1.0.0'
  const lifecycle = (
    subject: string,
    action: LifecycleRequest['action'] = 'install',
    generation = 1,
  ): LifecycleRequest => ({
    appId: 'shop-tools',
    subject,
    action,
    generation,
    releaseId,
    operationId: randomUUID(),
  })
  const install = lifecycle(subject)
  await service.lifecycle(install)
  await service.lifecycle(install)
  await service.lifecycle(lifecycle(other))
  const request = (
    subject: string,
    method: string,
    args: unknown,
    invocationId = randomUUID(),
    generation = 1,
  ): BackendInvocation => ({
    appId: 'shop-tools',
    subject,
    generation,
    releaseId,
    invocationId,
    method,
    arguments: args,
  })
  const sheet = newSheet('商品定价 1', defaultConfig().basic)
  sheet.rows = [
    {
      ...newRow(defaultConfig().basic),
      sku: '0001',
      name: '商品',
      cost: '100',
      weight: '0.5',
      target: '20',
    },
  ]
  const state: WorkspaceState = {
    book: { version: 1, activeSheetId: sheet.id, sheets: [sheet] },
    config: { ...defaultConfig(), creativeTemplates: [{ id: 'english', name: '英语主图', language: '英语', title: '短标题', description: '列出规格', image: '白底' }] },
    detail: null,
    comparison: null,
  }
  const patch: WorkspacePatch = {
    revision: 0,
    metadata: metadataOf(state),
    config: state.config,
    history: { detail: null, comparison: null },
    upserts: [{ sheetId: sheet.id, position: 0, row: sheet.rows[0]! }],
    removals: [],
  }
  const first = request(subject, 'workspace_patch', patch)
  assert.deepEqual(await service.invoke(first), { revision: 1 })
  assert.deepEqual(await service.invoke(first), { revision: 1 })
  await assert.rejects(
    () =>
      service.invoke({
        ...first,
        arguments: {
          ...patch,
          config: {
            ...state.config,
            basic: { ...state.config.basic, loss: 0 },
          },
        },
      }),
    { code: 'SHOP_REPLAY_CONFLICT' },
  )
  assert.equal(
    (
      (await service.invoke(
        request(other, 'workspace_get', {}),
      )) as WorkspaceHeader
    ).metadata,
    null,
  )
  const restored = new ShopToolsService(source)
  const header = (await restored.invoke(
    request(subject, 'workspace_get', {}),
  )) as WorkspaceHeader
  assert.equal(header.revision, 1)
  assert.deepEqual(header.config?.creativeTemplates, state.config.creativeTemplates)
  assert.equal(header.config?.basic.loss, 4)
  assert.equal(header.metadata?.sheets[0]?.name, sheet.name)
  const page = (await restored.invoke(
    request(subject, 'workspace_rows', { revision: 1, offset: 0 }),
  )) as { items: { row: { sku: string } }[] }
  assert.equal(page.items[0]?.row.sku, '0001')
  const changes = [0, 8].map((loss) =>
    request(subject, 'workspace_patch', {
      revision: 1,
      config: { ...state.config, basic: { ...state.config.basic, loss } },
      upserts: [],
      removals: [],
    }),
  )
  const simultaneous = await Promise.allSettled(
    changes.map((r) => service.invoke(r)),
  )
  assert.equal(simultaneous.filter((v) => v.status === 'fulfilled').length, 1)
  assert.equal(
    simultaneous.filter(
      (v) => v.status === 'rejected' && v.reason.code === 'SHOP_CONFLICT',
    ).length,
    1,
  )
  await assert.rejects(
    () =>
      service.invoke(
        request(subject, 'workspace_rows', { revision: 1, offset: 0 }),
      ),
    { code: 'SHOP_CONFLICT' },
  )
  let revision = 2
  const rows = Array.from({ length: 1000 }, (_, i) =>
    i === 0
      ? sheet.rows[0]!
      : { ...newRow(state.config.basic), sku: String(i) })
  for (let i = 0; i < rows.length; i += 100) {
    await service.invoke(
      request(subject, 'workspace_patch', {
        revision,
        upserts: rows
          .slice(i, i + 100)
          .map((row, j) => ({ sheetId: sheet.id, position: i + j, row })),
        removals: [],
      }),
    )
    revision++
  }
  await assert.rejects(
    () =>
      service.invoke(
        request(subject, 'workspace_patch', {
          revision,
          upserts: [{ sheetId: sheet.id, position: 999, row: newRow() }],
          removals: [],
        }),
      ),
    /1000/,
  )
  assert.equal(
    (
      (await service.invoke(
        request(subject, 'workspace_get', {}),
      )) as WorkspaceHeader
    ).revision,
    revision,
  )
  let offset: number | null = 0
  let count = 0
  while (offset !== null) {
    const page = (await service.invoke(
      request(subject, 'workspace_rows', { revision, offset }),
    )) as { items: unknown[], nextOffset: number | null }
    count += page.items.length
    offset = page.nextOffset
  }
  assert.equal(count, 1000)
  await service.invoke(
    request(subject, 'workspace_patch', {
      revision,
      upserts: [],
      removals: [
        { sheetId: sheet.id, id: rows[10]!.id },
        { sheetId: sheet.id, id: rows[11]!.id },
      ],
    }),
  )
  revision++
  assert.equal(
    await source.getRepository('ShopToolsProduct').countBy({ subject }),
    998,
  )
  await service.invoke(
    request(other, 'workspace_patch', {
      ...patch,
      upserts: [
        {
          sheetId: sheet.id,
          position: 0,
          row: { ...sheet.rows[0]!, sku: 'OTHER-ACCOUNT' },
        },
      ],
    }),
  )
  const ownerPage = (await service.invoke(
    request(subject, 'workspace_rows', { revision, offset: 0 }),
  )) as { items: { row: { sku: string } }[] }
  assert.equal(ownerPage.items[0]?.row.sku, '0001')
  const uninstall = lifecycle(subject, 'uninstall')
  await service.lifecycle(uninstall)
  await assert.rejects(
    () =>
      service.invoke(
        request(subject, 'workspace_patch', { ...patch, revision }),
      ),
    { code: 'SHOP_INSTALLATION_CHANGED' },
  )
  await service.lifecycle(lifecycle(subject, 'install', 2))
  const reinstalled = (await service.invoke(
    request(subject, 'workspace_get', {}, randomUUID(), 2),
  )) as WorkspaceHeader
  assert.equal(reinstalled.revision, revision)
  assert.equal(reinstalled.metadata?.sheets[0]?.id, sheet.id)
  await assert.rejects(
    () => service.lifecycle({ ...install, operationId: randomUUID() }),
    { code: 'SHOP_INSTALLATION_CHANGED' },
  )
  const newSheetValue = newSheet('新表')
  await service.invoke(
    request(
      subject,
      'workspace_patch',
      {
        revision,
        metadata: {
          activeSheetId: newSheetValue.id,
          sheets: [
            {
              id: newSheetValue.id,
              name: newSheetValue.name,
              settings: newSheetValue.settings,
            },
          ],
        },
        upserts: [],
        removals: [],
      },
      randomUUID(),
      2,
    ),
  )
  const afterDelete = (await service.invoke(
    request(
      subject,
      'workspace_rows',
      { revision: revision + 1, offset: 0 },
      randomUUID(),
      2,
    ),
  )) as { items: unknown[] }
  assert.equal(afterDelete.items.length, 0)
  const projectCall = (actor: string, action: string, args: Record<string, unknown> = {}) =>
    service.invoke(request(actor, 'projects', { action, ...args }, randomUUID(), actor === subject ? 2 : 1))
  await projectCall(subject, 'list')
  const projectRead = (actor: string, id: string) =>
    service.invoke(request(actor, 'workspace_get', { projectId: id }, randomUUID(), actor === subject ? 2 : 1)) as Promise<WorkspaceHeader>
  assert.equal((await projectRead(subject, subject)).revision, revision + 1)
  const { id: projectId } = await projectCall(subject, 'create', { name: '团队', site: 'MY' }) as { id: string }
  assert.equal((await projectRead(subject, projectId)).revision, 0)
  await assert.rejects(projectRead(other, projectId), { code: 'SHOP_PROJECT_DENIED' })
  const { code } = await projectCall(subject, 'invite', { projectId, role: 'viewer' }) as { code: string }
  await projectCall(other, 'join', { code, name: '同事' })
  await assert.rejects(projectCall(other, 'join', { code, name: '重复加入' }))
  assert.equal((await projectRead(other, projectId)).revision, 0)
  const write = () => service.invoke(request(other, 'workspace_patch', { ...patch, projectId, revision: 0 }))
  await assert.rejects(write(), { code: 'SHOP_PROJECT_DENIED' })
  await assert.rejects(projectCall(other, 'role', { projectId, subject: other, role: 'admin' }), { code: 'SHOP_PROJECT_DENIED' })
  const input = { title: '旅行杯', description: '', imageId: 'sample', fields: ['title', 'image'], rules: { title: '简短', description: '', image: '白底', language: '英语' } }
  const create = { projectId, action: 'create', input }
  await assert.rejects(service.invoke(request(other, 'creative', create)), { code: 'SHOP_PROJECT_DENIED' })
  const submission = request(subject, 'creative', create, randomUUID(), 2)
  const [job, replay] = await Promise.all([service.invoke(submission), service.invoke(submission)]) as { id: string }[]
  assert.deepEqual(job, replay)
  const get = { projectId, action: 'get', id: job!.id }
  let result: Creation | null = null
  for (let i = 0; i < 100; i++) {
    result = await service.invoke(request(subject, 'creative', get, randomUUID(), 2)) as Creation
    if (result.status === 'finished') {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(textCalls, 1)
  assert.equal(result?.status, 'finished')
  assert.deepEqual(result?.input, input)
  assert.deepEqual(result?.output, { title: 'Travel cup' })
  assert.match(result!.errors[0]!, /图片/)
  assert.equal(await service.invoke(request(other, 'creative', get)), null)
  await projectCall(subject, 'role', { projectId, subject: other, role: 'editor' })
  await write()
  assert.equal((await projectRead(subject, projectId)).revision, 1)
  await projectCall(subject, 'remove', { projectId, subject: other })
  await assert.rejects(projectRead(other, projectId), { code: 'SHOP_PROJECT_DENIED' })
  // Collection ownership, duplicate claims, version conflicts and temporary generation.
  const catalog = new ShopCatalog(source)
  const collected = { id: 'source-a', platform: '1688', platformName: '1688', sourceId: 'item-a', sourceUrl: 'https://example.com/item-a', title: '收纳盒', description: '来源描述', capturedAt: new Date().toISOString(), price: { amount: '10', currency: 'CNY' }, assets: [{ role: 'video', url: 'https://example.com/product.mp4' }], attributes: [], packaging: [], variants: [{ id: 'sku-1', sku: 'WHITE', price: '10', currency: 'CNY', images: ['https://example.com/white.jpg'], attributes: [{ name: '颜色', value: '白色' }] }] }
  const imported = await catalog.collect(subject, [collected])
  assert.deepEqual(await catalog.collect(subject, [collected]), imported)
  const cat = <T = unknown>(actor: string, action: string, args: Record<string, unknown> = {}) => service.invoke(request(actor, 'catalog', { action, projectId, ...args }, randomUUID(), actor === subject ? 2 : 1)) as Promise<T>
  assert.equal((await cat<{ items: unknown[] }>(other, 'collection')).items.length, 0)
  await assert.rejects(cat(other, 'claim', { ids: imported.ids }), { code: 'SHOP_PROJECT_DENIED' })
  await Promise.all([cat(subject, 'claim', { ids: imported.ids }), cat(subject, 'claim', { ids: imported.ids })])
  const products = await cat<{ items: { id: string }[] }>(subject, 'list')
  assert.equal(products.items.length, 1)
  const item = await cat<import('@t-box/shop-tools-contracts').CatalogDetail>(subject, 'get', { id: products.items[0]!.id })
  const version = item.versions[0]!
  assert.equal(version.content.skus[0]!.cost, 10)
  assert.equal(version.content.skus[0]!.sourceSkuId, 'sku-1')
  assert.deepEqual(version.content.skus[0]!.images, ['https://example.com/white.jpg'])
  assert.deepEqual(version.content.videos, ['https://example.com/product.mp4'])
  const changed = { ...version.content, title: '修改后的商品' }
  await cat(subject, 'save', { id: item.product.id, versionId: version.id, revision: 0, name: version.name, content: changed })
  await assert.rejects(cat(subject, 'save', { id: item.product.id, versionId: version.id, revision: 0, name: version.name, content: changed }), { code: 'SHOP_CONFLICT' })
  const second = await cat<{ id: string }>(subject, 'version', { id: item.product.id, versionId: version.id, revision: 1 })
  assert.ok(second.id)
  const updated = await cat<import('@t-box/shop-tools-contracts').CatalogDetail>(subject, 'get', { id: item.product.id })
  assert.equal(updated.versions.length, 2)
  for (const saved of updated.versions) {
    assert.deepEqual(saved.content.skus[0]!.images, ['https://example.com/white.jpg'])
    assert.deepEqual(saved.content.videos, ['https://example.com/product.mp4'])
  }
  assert.equal(updated.product.modified, true)
  assert.equal((await cat<{ items: import('@t-box/shop-tools-contracts').CollectionItem[] }>(subject, 'collection')).items[0]!.data.title, collected.title)
  await assert.rejects(cat(subject, 'set-site', { site: 'TH' }))
  const productId = item.product.id
  const settings = await cat<import('@t-box/shop-tools-contracts').ProjectPrompt>(subject, 'ai-settings')
  const savedRules = await cat<import('@t-box/shop-tools-contracts').ProjectPrompt>(subject, 'ai-save-settings', { revision: settings.revision, rules: { language: '英语', prompt: '白底，保留商品事实' } })
  await assert.rejects(cat(subject, 'ai-save-settings', { revision: 0, rules: settings }), { code: 'SHOP_CONFLICT' })
  const choices = Object.fromEntries(optimizationSlots(updated.versions[0]!.content).map((s) => [s.id, { mode: 'optimize' }]))
  const start = request(subject, 'catalog', { action: 'ai-start', projectId, productId, versionId: version.id, revision: 1, rulesRevision: savedRules.revision, choices, supplement: '' }, randomUUID(), 2)
  const started = await service.invoke(start) as { id: string }
  assert.deepEqual(await service.invoke(start), started)
  await assert.rejects(service.invoke({ ...start, arguments: { ...start.arguments as object, supplement: 'different' } }), { code: 'SHOP_REPLAY_CONFLICT' })
  const waitJob = async () => {
    for (let i = 0; i < 200; i++) {
      const j = await cat<import('@t-box/shop-tools-contracts').OptimizationJob>(subject, 'ai-get', { productId, jobId: started.id })
      if (j.status === 'finished') {
        return j
      }
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('optimization timeout')
  }
  const failedJob = await waitJob()
  assert.equal(catalogTextCalls, 1)
  const failedIds = Object.keys(failedJob.results).filter((id) => failedJob.results[id]!.status === 'failed')
  assert.equal(failedIds.length, 1)
  await assert.rejects(cat(subject, 'ai-apply', { productId, jobId: started.id, edits: {} }))
  await cat(subject, 'ai-save-settings', { revision: savedRules.revision, rules: { language: '泰语', prompt: '修改后的要求' } })
  await cat(subject, 'ai-retry', { productId, jobId: started.id, ids: failedIds })
  const complete = await waitJob()
  assert.equal(complete.snapshot.rules.language, '英语')
  assert.equal(catalogTextCalls, 1)
  assert.equal(imageAttempts, 2)
  const applied = await cat<{ id: string }>(subject, 'ai-apply', { productId, jobId: started.id, edits: { title: '确认标题' } })
  assert.deepEqual(await cat(subject, 'ai-apply', { productId, jobId: started.id, edits: {} }), applied)
  const final = await cat<import('@t-box/shop-tools-contracts').CatalogDetail>(subject, 'get', { id: productId })
  assert.equal(final.versions.length, 3)
  const optimized = final.versions.find((v) => v.id === applied.id)!
  assert.equal(optimized.content.title, '确认标题')
  assert.equal(optimized.content.skus[0]!.id, version.content.skus[0]!.id)
  assert.equal(optimized.content.media![0]!.skuId, version.content.skus[0]!.id)
  assert.equal(optimized.content.media![0]!.fileId, 'generated-file')
  assert.equal(optimized.content.skus[0]!.cost, 10)
  assert.deepEqual(optimized.content.videos, version.content.videos)
  assert.equal(final.versions.find((v) => v.id === version.id)!.content.title, changed.title)
  await cat(subject, 'ai-image', { productId, fileId: 'generated-file' })
  await assert.rejects(cat(subject, 'ai-image', { productId, fileId: 'unrelated-file' }), { code: 'SHOP_PROJECT_DENIED' })
  await assert.rejects(cat(other, 'ai-get', { productId, jobId: started.id }), { code: 'SHOP_PROJECT_DENIED' })
  const before = await source.getRepository('ShopToolsCreation').count()
  const temporary = await service.invoke(request(subject, 'creative', { temporary: true, action: 'create', input: { ...input, imageId: '', fields: ['title'] } }, randomUUID(), 2)) as { id: string }
  for (let i = 0; i < 100; i++) {
    const rec = await service.invoke(request(subject, 'creative', { temporary: true, action: 'get', id: temporary.id }, randomUUID(), 2)) as Creation
    if (rec.status === 'finished') {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(await source.getRepository('ShopToolsCreation').count(), before)
  assert.equal(await service.invoke(request(other, 'creative', { temporary: true, action: 'get', id: temporary.id })), null)
  console.log(
    'Shop tools MySQL integration passed: extension replay, account isolation, durable rows/config, CAS concurrency, idempotency, pagination, rollback, installation fencing and data retention.',
  )
} finally {
  if (source.isInitialized) {
    await source.destroy()
  }
  // native-sql: remove only the random disposable test schema created above.
  await control.query(`DROP DATABASE ${database}`)
  await control.end()
}
