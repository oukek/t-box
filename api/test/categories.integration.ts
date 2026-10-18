import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chatContext } from '@t-box/ledger-server/ai/context'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'
import { serverTool } from './tool-harness.js'

const source = await createDataSource().initialize()
const p = new PlatformService(source)
const users: string[] = []
try {
  const session = await p.identity.register(
    {
      username: `cat_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
    },
    'fixture',
  )
  users.push(session.user.id)
  const actor = await p.identity.authenticate(session.token)
  const book = (await p.ledgers.list(actor))[0]!
  const second = await p.ledgers.create(actor, {
    name: '第二本',
    template: 'daily',
  })
  const defaults = await p.finance.categories(actor, book.id)
  assert.ok(defaults.length > 0 && defaults.every((row) => row.active === true), 'new ledgers preserve enabled preset booleans through the ORM')
  assert(
    defaults.some((row) => row.type === 'income' && row.label === '其他收入'),
  )
  assert(
    defaults.some((row) => row.type === 'expense' && row.label === '其他支出'),
  )
  const label = '自定义分类'
  const expense = await p.finance.createCategory(actor, book.id, randomUUID(), {
    type: 'expense',
    label,
  })
  const income = await p.finance.createCategory(actor, book.id, randomUUID(), {
    type: 'income',
    label,
  })
  await assert.rejects(() =>
    p.finance.createCategory(actor, book.id, randomUUID(), {
      type: 'expense',
      label,
    }),
  )
  await p.finance.createCategory(actor, second.id, randomUUID(), {
    type: 'expense',
    label,
  })
  await p.finance.features.categories.update(actor, book.id, expense.id, randomUUID(), { pinned: true })
  await p.finance.features.categories.update(actor, book.id, expense.id, randomUUID(), { label: `${label}更新` })
  const updatedCategory = (await p.finance.categories(actor, book.id)).find((row) => row.id === expense.id)!
  assert.equal(updatedCategory.active, true, 'partial updates preserve enabled status')
  assert.equal(updatedCategory.pinned, true, 'partial updates preserve pinned status')
  const context = await chatContext(p, actor, book.id, randomUUID())
  const skills = new Set(['bookkeeping'])
  const input = {
    type: 'expense',
    amount: '1.23',
    category: expense.id,
    date: '2026-01-01',
    note: '分类测试',
  }
  const bill = (await serverTool(
    'bills_create',
    input,
    skills,
    context.bills,
    context.categories,
  )) as { id: string }
  assert.equal(
    (await p.finance.getBill(actor, book.id, bill.id)).amount,
    '1.23',
  )
  await assert.rejects(() =>
    p.finance.createBill(actor, second.id, randomUUID(), input),
  )
  await assert.rejects(() =>
    p.finance.updateBill(actor, book.id, bill.id, randomUUID(), {
      type: 'income',
    }),
  )
  await p.finance.updateBill(actor, book.id, bill.id, randomUUID(), {
    type: 'income',
    category: income.id,
    amount: '2.50',
  })
  await assert.rejects(() =>
    source.query('UPDATE bills SET type=? WHERE id=?', ['expense', bill.id]),
  )
  await assert.rejects(() =>
    source.query('DELETE FROM bill_categories WHERE id=?', [income.id]),
  )
  assert.equal(
    (
      await p.statistics.get(actor, book.id, {
        period: 'month',
        value: '2026-01',
      })
    ).income,
    '2.50',
  )
  assert.equal(
    (
      await p.statistics.get(actor, second.id, {
        period: 'month',
        value: '2026-01',
      })
    ).income,
    '0.00',
  )
  console.log(
    'PASS: scoped default/custom categories, exact money, REST/tool parity and cross-ledger DB constraints.',
  )
} finally {
  await cleanupUsers(source, users)
  await source.destroy()
}
