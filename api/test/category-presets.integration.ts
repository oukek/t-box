import type { DataSource } from 'typeorm'
/** Exercise real MySQL fan-out in a rollback-only transaction: no live categories are changed. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { registerLedgerCategoryAdministration } from '@t-box/ledger-server/categories/admin-routes'
import { CategoryPresetAdministration } from '@t-box/ledger-server/categories/administration'
import { createLedgerRows } from '@t-box/ledger-server/ledgers/create'
import { ApiError } from '@t-box/server-foundation/errors'
import Fastify from 'fastify'
import { createDataSource } from '../src/db/data-source.js'

const source = await createDataSource().initialize()
const runner = source.createQueryRunner()
await runner.connect()
await runner.startTransaction()
const db = runner.manager
const transactionalSource = {
  query: db.query.bind(db),
  transaction: (work: (manager: typeof db) => Promise<unknown>) => work(db),
} as unknown as DataSource
const service = new CategoryPresetAdministration(transactionalSource)
const app = Fastify()
const actorId = randomUUID()
app.addHook('preHandler', async (r) => {
  if (r.headers.authorization !== 'Bearer test-admin') {
    throw new ApiError(401, 'UNAUTHORIZED', '需要管理员登录')
  }
})
app.setErrorHandler((e, _r, reply) => {
  reply
    .code(e instanceof ApiError ? e.statusCode : 500)
    .send({ error: e instanceof Error ? e.message : '测试请求失败' })
})
registerLedgerCategoryAdministration(app, service, async () => ({
  id: actorId,
}))
let checks = 0
async function call(
  method: any,
  url: string,
  body?: unknown,
  status = 200,
  authorized = true,
) {
  const r = await app.inject({
    method,
    url,
    headers: authorized ? { authorization: 'Bearer test-admin' } : {},
    ...(body === undefined ? {} : { payload: body as any }),
  })
  assert.equal(r.statusCode, status, r.body)
  checks++
  return r.json().data
}
try {
  await call('GET', '/ledger/category-presets', undefined, 401, false)
  await call('POST', '/ledger/category-presets', {}, 401, false)
  const owner = randomUUID()
  await db.query(
    'INSERT INTO app_users(id,username,nickname,password_hash) VALUES(?,?,?,?)',
    [
      owner,
      `category-test-${owner.slice(0, 8)}`,
      '回滚测试',
      'unusable-rollback-only-hash',
    ],
  )
  const existingBook = await createLedgerRows(db, owner, {
    name: '回滚分类测试',
    template: 'daily',
  })
  const input = {
    type: 'expense',
    label: `测试-${randomUUID().slice(0, 8)}`,
    icon: 'other',
    active: false,
    sortOrder: 9876,
  }
  const preset = await call('POST', '/ledger/category-presets', input, 201)
  assert.equal(preset.active, false)
  const [local] = await db.query(
    'SELECT * FROM bill_categories WHERE ledger_id=? AND preset_id=?',
    [existingBook, preset.id],
  )
  assert.equal(Number(local.is_default), 1)
  assert.equal(Number(local.active), 0)
  const laterBook = await createLedgerRows(db, owner, {
    name: '新账本分类测试',
    template: 'daily',
  })
  const [later] = await db.query(
    'SELECT * FROM bill_categories WHERE ledger_id=? AND preset_id=?',
    [laterBook, preset.id],
  )
  assert.equal(later.label, input.label)
  assert.equal(Number(later.active), 0)
  // The system namespace can coexist with a custom category of the same name.
  await db.query(
    'INSERT INTO bill_categories(id,ledger_id,type,label,icon,is_default) VALUES(?,?,?,?,\'other\',FALSE)',
    [randomUUID(), existingBook, 'expense', input.label],
  )
  const update = {
    label: input.label + '更新',
    icon: 'wallet',
    active: true,
    sortOrder: 1,
    revision: preset.revision,
  }
  const saved = await call(
    'PATCH',
    `/ledger/category-presets/${preset.id}`,
    update,
  )
  assert.equal(saved.revision, 2)
  const updated = await db.query(
    'SELECT * FROM bill_categories WHERE preset_id=?',
    [preset.id],
  )
  assert.ok(updated.length >= 2)
  assert.ok(
    updated.every(
      (r: any) =>
        r.label === update.label &&
        Number(r.active) === 1 &&
        Number(r.sort_order) === 1,
    ),
  )
  assert.equal(
    updated.find((r: any) => r.ledger_id === existingBook).id,
    local.id,
  )
  const [{ label }] = await db.query(
    'SELECT label FROM bill_categories WHERE ledger_id=? AND is_default=FALSE AND label=?',
    [existingBook, input.label],
  )
  assert.equal(label, input.label)
  await call('PATCH', `/ledger/category-presets/${preset.id}`, update, 409)
  await call(
    'PATCH',
    `/ledger/category-presets/${preset.id}`,
    { ...update, revision: 2, type: 'income' },
    400,
  )
  await call(
    'POST',
    '/ledger/category-presets',
    { ...input, label: saved.label },
    409,
  )
  await call('PATCH', `/ledger/category-presets/${preset.id}`, {
    ...update,
    active: false,
    revision: 2,
  })
  assert.equal(
    (await db.query('SELECT id FROM bill_categories WHERE id=?', [local.id]))
      .length,
    1,
  )
  assert.equal(
    (
      await db.query(
        'SELECT id FROM ledger_category_preset_audit WHERE preset_id=?',
        [preset.id],
      )
    ).length,
    3,
  )
  const [{ n }] = await db.query(
    'SELECT COUNT(*) AS n FROM ledger_category_preset_audit WHERE preset_id=? AND administrator_id=?',
    [preset.id, actorId],
  )
  assert.equal(Number(n), 3)
  console.log(
    `Category presets: ${checks} REST checks plus synchronization, ID preservation, custom isolation and audit assertions passed (rolled back).`,
  )
} finally {
  await app.close()
  await runner.rollbackTransaction()
  await runner.release()
  await source.destroy()
}
