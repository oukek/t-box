import type { BackendInvocation, LifecycleRequest } from '@t-box/app-contracts'
import type {
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
} from '@t-box/shop-tools-core'
import { shopToolsSchema, ShopToolsService } from '@t-box/shop-tools-server'
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
// native-sql: isolated test database DDL; the random guarded name never targets an application database.
await control.query(
  `CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
)
const source = createDataSource({ ...config, database })
try {
  await source.initialize()
  const runner = source.createQueryRunner()
  await runner.connect()
  try {
    assert.equal(await extendDatabase(runner, [shopToolsSchema]), 1)
    assert.equal(await extendDatabase(runner, [shopToolsSchema]), 0)
  } finally {
    await runner.release()
  }
  assert.ok(
    source.entityMetadatas
      .filter((m) => m.tableName.startsWith('shop_tools_'))
      .every((m) => m.foreignKeys.length === 0),
  )
  const service = new ShopToolsService(source)
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
    config: defaultConfig(),
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
