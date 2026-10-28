import type { QueryRunner } from 'typeorm'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chatContext } from '@t-box/ledger-server/ai/context'
import { ledgerTools } from '@t-box/ledger-server/ai/tools'
import { createCategoryRepository } from '@t-box/ledger-server/categories/repository'
import { nextOccurrence } from '@t-box/ledger-server/features/planning'
import { LedgerScheduler } from '@t-box/ledger-server/features/worker'
import { today } from '@t-box/ledger-server/ledgers/validation'
import {
  aggregateSummary,
  createBillRepository,
} from '@t-box/ledger-server/repository'
import { createApp } from '../src/app.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { fixtureOss } from './oss-fixture.js'

const source = createDataSource()
await source.initialize()
const activeRunners = new Set<QueryRunner>()
const createRunner = source.createQueryRunner.bind(source)
source.createQueryRunner = (...args) => {
  const runner = createRunner(...args)
  activeRunners.add(runner)
  const release = runner.release.bind(runner)
  runner.release = async () => {
    try {
      await release()
    } finally {
      activeRunners.delete(runner)
    }
  }
  return runner
}
const oss = fixtureOss(() => {
  assert.ok([...activeRunners].every((runner) => !runner.isTransactionActive), 'object uploads must not hold a database transaction')
})
const p = new PlatformService(source, undefined, undefined, undefined, undefined, oss.resources(source))
const app = createApp({
  logger: { level: 'error' },
  platform: p,
  bills: createBillRepository(source),
  categories: createCategoryRepository(source),
  health: async () => ({ mysql: 'up', redis: 'disabled' }),
})
const users: string[] = []
const books: string[] = []
const resources: { userId: string, id: string }[] = []
let checks = 0
async function call(
  method: any,
  url: string,
  token: string,
  body?: unknown,
  status = 200,
  key = randomUUID(),
) {
  const r = await app.inject({
    method,
    url,
    headers: { 'authorization': `Bearer ${token}`, 'idempotency-key': key },
    ...(body === undefined ? {} : { payload: body as any }),
  })
  assert.equal(r.statusCode, status, `${method} ${url}: ${r.body}`)
  checks++
  return status === 204 ? null : r.json().data
}
try {
  const actors: any[] = []
  for (let i = 0; i < 3; i++) {
    const a = await call(
      'POST',
      '/api/v1/auth/register',
      '',
      {
        username: `test_${randomUUID().replaceAll('-', '')}`,
        password: 'test123',
        nickname: `功能测试${i}`,
      },
      201,
    )
    actors.push(a)
    users.push(a.user.id)
    books.push(
      ...(await call('GET', '/api/v1/ledgers', a.token)).map((b: any) => b.id),
    )
  }
  const [owner, editor, outsider] = actors
  const token = owner.token
  const book = await call(
    'POST',
    '/api/v1/ledgers',
    token,
    { name: '功能集成测试', template: 'combined' },
    201,
  )
  books.push(book.id)
  const root = `/api/v1/ledgers/${book.id}`
  await source.query(
    'INSERT INTO ledger_members(ledger_id,user_id,role) VALUES(?,?,\'editor\')',
    [book.id, editor.user.id],
  )
  const categories = await call('GET', root + '/categories', token)
  const systemExpense = categories.find((c: any) => c.type === 'expense')
  const expense = await call(
    'POST',
    root + '/categories',
    token,
    { type: 'expense', label: '自定义测试支出', icon: 'other' },
    201,
  )
  const income = categories.find((c: any) => c.type === 'income')
  const otherExpense = categories.filter((c: any) => c.type === 'expense')[1]
  await call(
    'PATCH',
    root + `/categories/${systemExpense.id}`,
    token,
    { label: '不可改名' },
    403,
  )
  await call(
    'DELETE',
    root + `/categories/${systemExpense.id}`,
    token,
    undefined,
    403,
  )
  await call(
    'POST',
    root + `/categories/${systemExpense.id}/merge`,
    token,
    { targetId: otherExpense.id },
    403,
  )
  const d = '2026-01-03'
  const bill = (
    type: string,
    amount: string,
    note: string,
    accountId: string | null = null,
  ) => ({
    type,
    amount,
    category: type === 'expense' ? expense.id : income.id,
    date: d,
    note,
    accountId,
  })
  const a = await call('POST', root + '/accounts', token, {
    name: '钱包',
    kind: 'wallet',
    openingBalance: '1000',
    date: d,
  })
  const b = await call('POST', root + '/accounts', token, {
    name: '银行卡',
    kind: 'bank',
    openingBalance: '0',
    date: d,
  })
  const input = {
    items: [
      {
        kind: 'bill',
        ref: 'buy',
        input: bill('expense', '100.25', '购买', a.id),
      },
      { kind: 'bill', input: bill('income', '200', '工资', a.id) },
      {
        kind: 'debt',
        ref: 'loan',
        input: {
          direction: 'receivable',
          counterparty: '张三',
          amount: '300',
          date: d,
          dueDate: null,
          note: '借出',
          cashMovement: true,
          accountId: a.id,
        },
      },
      {
        kind: 'settlement',
        input: {
          date: d,
          note: '收到部分',
          accountId: a.id,
          allocations: [{ debtId: 'ref:loan', amount: '80' }],
        },
      },
      {
        kind: 'refund',
        input: {
          billId: 'ref:buy',
          amount: '20.25',
          date: d,
          note: '部分退款',
          accountId: a.id,
        },
      },
      {
        kind: 'transfer',
        input: {
          fromAccountId: a.id,
          toAccountId: b.id,
          amount: '50',
          date: d,
          note: '转入银行卡',
        },
      },
    ],
  }
  const idem = randomUUID()
  const batch = await call('POST', root + '/batch', token, input, 200, idem)
  assert.equal(batch.items.length, 6)
  assert.deepEqual(
    await call('POST', root + '/batch', token, input, 200, idem),
    batch,
  )
  await call(
    'POST',
    root + '/batch',
    token,
    { items: input.items.slice(0, 1) },
    409,
    idem,
  )
  const stats = await call(
    'GET',
    root + '/statistics?period=year&value=2026',
    token,
  )
  assert.equal(stats.expense, '80.00')
  assert.equal(stats.income, '200.00')
  assert.equal(stats.currentReceivable, '220.00')
  assert.equal(stats.grossExpense, '100.25')
  assert.equal(stats.refunded, '20.25')
  const balances = await call('GET', root + '/accounts', token)
  assert.equal(balances.find((x: any) => x.id === a.id).balance, '850.00')
  assert.equal(balances.find((x: any) => x.id === b.id).balance, '50.00')
  const before = await source.query('SELECT revision FROM ledgers WHERE id=?', [
    book.id,
  ])
  await call(
    'POST',
    root + '/batch',
    token,
    {
      items: [
        { kind: 'bill', input: bill('expense', '7', '必须回滚', a.id) },
        {
          kind: 'transfer',
          input: {
            fromAccountId: a.id,
            toAccountId: a.id,
            amount: '1',
            date: d,
            note: '',
          },
        },
      ],
    },
    400,
  )
  assert.deepEqual(
    await source.query('SELECT revision FROM ledgers WHERE id=?', [book.id]),
    before,
  )
  assert.equal(
    (await call('GET', root + '/bills?q=必须回滚', token)).length,
    0,
  )
  assert.deepEqual(await call('GET', root + '/accounts', token), balances)
  await call('POST', root + '/batch', outsider.token, input, 404)
  await source.query(
    'UPDATE ledger_members SET role=\'viewer\' WHERE ledger_id=? AND user_id=?',
    [book.id, editor.user.id],
  )
  await call('POST', root + '/batch', editor.token, input, 403)
  await source.query(
    'UPDATE ledger_members SET role=\'editor\' WHERE ledger_id=? AND user_id=?',
    [book.id, editor.user.id],
  )
  await call(
    'PATCH',
    root + `/categories/${expense.id}`,
    editor.token,
    { label: '越权' },
    403,
  )
  const original = batch.items[0].result
  await call(
    'PATCH',
    root + `/bills/${original.id}`,
    token,
    { note: '备注可修正' },
    200,
  )
  await call(
    'PATCH',
    root + `/bills/${original.id}`,
    token,
    { amount: '101' },
    409,
  )
  await call('DELETE', root + `/bills/${original.id}`, token, undefined, 409)
  const reimb = await call('POST', root + '/reimbursements', token, {
    billId: original.id,
    counterparty: '公司',
    amount: '30',
  })
  assert.equal(
    (await call('GET', root + '/statistics?period=year&value=2026', token))
      .currentReceivable,
    '250.00',
  )
  const receipt = await call(
    'POST',
    root + `/reimbursements/${reimb.id}/receipts`,
    token,
    { amount: '10', date: d, note: '到账', accountId: a.id },
  )
  assert.equal(
    (await call('GET', root + '/statistics?period=year&value=2026', token))
      .expense,
    '70.00',
  )
  await call(
    'POST',
    root + `/reimbursements/${reimb.id}/cancel`,
    token,
    {},
    400,
  )
  await call(
    'POST',
    root + `/reimbursement-receipts/${receipt.id}/reversal`,
    editor.token,
    {},
    403,
  )
  await call(
    'POST',
    root + `/reimbursement-receipts/${receipt.id}/reversal`,
    token,
    {},
  )
  await call('POST', root + `/reimbursements/${reimb.id}/cancel`, token, {})
  await call(
    'POST',
    root + `/reimbursements/${reimb.id}/receipts`,
    token,
    { amount: '1', date: d, note: '', accountId: null },
    400,
  )
  const loan = batch.items[2].result
  const adjust = await call(
    'POST',
    root + `/debts/${loan.id}/adjustments`,
    token,
    { kind: 'waiver', amount: '20', date: d, note: '协商减免', dueDate: null },
  )
  assert.equal(
    (await call('GET', root + '/statistics?period=year&value=2026', token))
      .currentReceivable,
    '200.00',
  )
  await call(
    'POST',
    root + `/debt-adjustments/${adjust.id}/reversal`,
    token,
    {},
  )
  await call('POST', root + `/debts/${loan.id}/adjustments`, token, {
    kind: 'extension',
    amount: null,
    date: null,
    note: '协商延期',
    dueDate: '2026-01-30',
  })
  const contact = await call('POST', root + '/contacts', token, {
    name: '张三',
    note: '同事',
  })
  assert.equal(
    (await call('GET', root + '/contacts', token)).find(
      (c: any) => c.id === contact.id,
    ).receivable,
    '220.00',
  )
  assert.ok(
    (await call('GET', root + '/debts/aging', token)).some(
      (r: any) => r.id === loan.id && r.contactId === contact.id,
    ),
  )
  const simple = await call(
    'POST',
    root + '/bills',
    token,
    bill('expense', '3.50', '可删除', a.id),
    201,
  )
  await call('DELETE', root + `/bills/${simple.id}`, token, undefined, 204)
  assert.ok(
    (await call('GET', root + '/bills/trash', token)).some(
      (r: any) => r.id === simple.id,
    ),
  )
  await call(
    'POST',
    root + `/bills/${simple.id}/restore`,
    editor.token,
    {},
    403,
  )
  await call('POST', root + `/bills/${simple.id}/restore`, token, {})
  const template = await call('POST', root + '/templates', token, {
    name: '常用',
    bill: bill('expense', '3.50', '模板'),
  })
  assert.equal(
    (await call('GET', root + '/templates', token)).find(
      (t: any) => t.id === template.id,
    ).bill.amount,
    '3.50',
  )
  await call('PATCH', root + `/categories/${expense.id}`, token, {
    pinned: true,
    sortOrder: 1,
    icon: 'wallet',
    label: '日常消费',
  })
  await call('POST', root + `/categories/${expense.id}/merge`, token, {
    targetId: otherExpense.id,
  })
  assert.equal(
    (await call('GET', root + `/bills/${original.id}/detail`, token)).bill
      .category,
    otherExpense.id,
  )
  assert.equal(
    (await call('GET', root + '/templates', token)).find(
      (t: any) => t.id === template.id,
    ).bill.category,
    otherExpense.id,
  )
  await call('POST', root + '/imports', token, { rows: [null] })
  const imported = {
    ...bill('expense', '11.20', '导入新账'),
    category: otherExpense.id,
  }
  const draft = await call('POST', root + '/imports', token, {
    rows: [imported, { ...imported, amount: 'bad' }],
  })
  assert.equal(draft.rows[1].input, null)
  await call(
    'POST',
    root + `/imports/${draft.id}/commit`,
    token,
    {
      rows: [
        { index: 1, input: imported },
        { index: 2, input: { ...imported, category: randomUUID() } },
      ],
      allowDuplicates: false,
    },
    400,
  )
  assert.equal(
    (await call('GET', root + '/bills?q=导入新账', token)).length,
    0,
  )
  const importResult = await call(
    'POST',
    root + `/imports/${draft.id}/commit`,
    token,
    { rows: [{ index: 1, input: imported }], allowDuplicates: false },
  )
  assert.deepEqual(
    await call('POST', root + `/imports/${draft.id}/commit`, token, {
      rows: [{ index: 1, input: imported }],
      allowDuplicates: false,
    }),
    importResult,
  )
  const dup = await call('POST', root + '/imports', token, {
    rows: [imported],
  })
  assert.equal(dup.rows[0].duplicate, true)
  await call(
    'POST',
    root + `/imports/${dup.id}/commit`,
    token,
    { rows: [{ index: 1, input: imported }], allowDuplicates: false },
    409,
  )
  const formula = await call(
    'POST',
    root + '/bills',
    token,
    { ...imported, note: '=HYPERLINK("x")' },
    201,
  )
  assert.ok(formula.id)
  const exported = await call(
    'GET',
    root + '/export?kind=bills&start=2026-01-01&end=2026-12-31',
    token,
  )
  assert.match(exported.csv, /'=HYPERLINK/)
  // Cross-period refunds must preserve negative net expense, including fractions.
  await call('POST', root + '/refunds', token, {
    billId: original.id,
    amount: '0.25',
    date: '2026-02-01',
    note: '跨月',
    accountId: a.id,
  })
  const feb = await call(
    'GET',
    root + '/statistics?period=month&value=2026-02',
    token,
  )
  assert.equal(feb.expense, '-0.25')
  assert.equal(feb.grossExpense, '0.00')
  assert.equal(
    (await call('GET', root + '/bills/summary?month=2026-02', token)).expense,
    '-0.25',
  )
  assert.equal(
    aggregateSummary([
      { type: 'expense', category: expense.id, amount: '-0.25', count: 0 },
    ]).expense,
    '-0.25',
  )
  const snapshot = await call(
    'GET',
    root + '/statistics?period=year&value=2026',
    token,
  )
  await call('POST', root + '/statistics/rebuild', token, {})
  assert.deepEqual(
    {
      ...(await call(
        'GET',
        root + '/statistics?period=year&value=2026',
        token,
      )),
      revision: 0,
    },
    { ...snapshot, revision: 0 },
  )
  const file = await call(
    'POST',
    root + `/bills/${simple.id}/attachments`,
    token,
    { name: '凭证.txt', base64: Buffer.from('账单凭证').toString('base64') },
  )
  resources.push({ id: file.resourceId, userId: owner.user.id })
  assert.equal(
    Buffer.from(
      (
        await call(
          'GET',
          root + `/attachments/${file.id}/content`,
          editor.token,
        )
      ).base64,
      'base64',
    ).toString(),
    '账单凭证',
  )
  await call(
    'GET',
    root + `/attachments/${file.id}/content`,
    outsider.token,
    undefined,
    404,
  )
  await call(
    'DELETE',
    root + `/bills/${simple.id}/attachments/${file.id}`,
    token,
    {},
  )
  assert.equal(
    (await call('GET', root + `/bills/${simple.id}/attachments`, token)).length,
    0,
  )
  assert.equal(
    nextOccurrence('2025-01-31', 'month', 1, '2025-02-28'),
    '2025-03-31',
  )
  assert.equal(
    nextOccurrence('2024-02-29', 'year', 1, '2025-02-28'),
    '2026-02-28',
  )
  const ruleBill = { ...imported, date: today() }
  const rule = await call('POST', root + '/rules', token, {
    name: '提醒规则',
    bill: ruleBill,
    frequency: 'month',
    interval: 1,
    startDate: today(),
    endDate: null,
    mode: 'remind',
  })
  const auto = await call('POST', root + '/rules', token, {
    name: '自动规则',
    bill: { ...ruleBill, note: '自动规则唯一' },
    frequency: 'month',
    interval: 1,
    startDate: today(),
    endDate: null,
    mode: 'automatic',
  })
  const scheduler = new LedgerScheduler(p.access, (user) =>
    p.applications.assertActive(user, 'ledger'))
  await scheduler.tick()
  await scheduler.tick()
  assert.equal(
    Number(
      (
        await source.query(
          'SELECT COUNT(*) n FROM ledger_rule_runs WHERE rule_id=?',
          [rule.id],
        )
      )[0].n,
    ),
    1,
  )
  assert.equal(
    (await call('GET', root + '/bills?q=自动规则唯一', token)).length,
    1,
  )
  await call('POST', root + '/budgets', token, {
    month: today().slice(0, 7),
    categoryId: null,
    amount: '10',
  })
  await scheduler.tick()
  assert.ok(
    (await call('GET', root + '/notices', token)).some(
      (n: any) => n.title === '预算已用完',
    ),
  )
  const principal = await p.identity.authenticate(token)
  const ctx = await chatContext(p, principal, book.id, randomUUID())
  assert.equal(ledgerTools.ledger_batch_create!.capability, 'write')
  assert.equal(ledgerTools.ledger_batch_create!.needsConfirmation, true)
  const consent: any = await (
    ctx.extra as Record<string, (v: unknown) => Promise<unknown>>
  ).confirm_ledger_batch_create!({
    items: Array.from({ length: 100 }, () => ({
      kind: 'bill',
      ref: null,
      input: imported,
    })),
  })
  assert.equal(consent.lines.length, 101)
  assert.match(consent.lines[99], /^100\./)
  await source.query(
    'UPDATE ledger_rules SET grant_version=0,next_date=? WHERE id=?',
    [today(), auto.id],
  )
  await scheduler.tick()
  assert.equal(
    (
      await source.query('SELECT enabled FROM ledger_rules WHERE id=?', [
        auto.id,
      ])
    )[0].enabled,
    0,
  )
  const parallelBill = await call(
    'POST',
    root + '/bills',
    token,
    { ...imported, amount: '100', note: '并发退款测试' },
    201,
  )
  const concurrent = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: 'POST',
        url: root + '/refunds',
        headers: {
          'authorization': `Bearer ${token}`,
          'idempotency-key': randomUUID(),
        },
        payload: {
          billId: parallelBill.id,
          amount: '60',
          date: d,
          note: '并发退款',
          accountId: a.id,
        },
      }),
    ),
  )
  assert.deepEqual(concurrent.map((r) => r.statusCode).sort(), [200, 400])
  const once = { ...imported, note: '并发导入唯一' }
  const drafts = await Promise.all(
    [1, 2].map(() => call('POST', root + '/imports', token, { rows: [once] })),
  )
  const commits = await Promise.all(
    drafts.map((x) =>
      app.inject({
        method: 'POST',
        url: root + `/imports/${x.id}/commit`,
        headers: {
          'authorization': `Bearer ${token}`,
          'idempotency-key': randomUUID(),
        },
        payload: { rows: [{ index: 1, input: once }], allowDuplicates: false },
      }),
    ),
  )
  assert.deepEqual(commits.map((r) => r.statusCode).sort(), [200, 409])
  assert.equal(
    (await call('GET', root + '/bills?q=并发导入唯一', token)).length,
    1,
  )
  const filtered = await call(
    'GET',
    root +
    `/bills?categoryId=${otherExpense.id}&memberId=${owner.user.id}&minAmount=10&maxAmount=20&start=2026-01-01&end=2026-01-31`,
    token,
  )
  assert.ok(filtered.some((r: any) => r.note === '导入新账'))
  assert.ok(
    filtered.every(
      (r: any) => Number(r.amount) >= 10 && Number(r.amount) <= 20,
    ),
  )
  for (const kind of [
    'settlements',
    'refunds',
    'reimbursements',
    'events',
    'accountEntries',
  ]) {
    assert.ok(
      (
        await call(
          'GET',
          root + `/export?kind=${kind}&start=2026-01-01&end=2026-12-31`,
          token,
        )
      ).csv,
    )
  }
  const baseAccounts = await call('GET', root + '/accounts', token)
  const originalBalance = baseAccounts.find((r: any) => r.id === b.id).balance
  const reconciled = await call(
    'POST',
    root + `/accounts/${b.id}/reconcile`,
    token,
    { balance: '75', date: d, note: '盘点' },
  )
  assert.equal(reconciled.balance, '75.00')
  assert.equal(
    (await call('GET', root + '/accounts', token)).find(
      (r: any) => r.id === b.id,
    ).balance,
    '75.00',
  )
  await call('PATCH', root + `/accounts/${b.id}`, token, { archived: true })
  await call(
    'POST',
    root + '/batch',
    token,
    {
      items: [
        {
          kind: 'transfer',
          input: {
            fromAccountId: a.id,
            toAccountId: b.id,
            amount: '1',
            date: d,
            note: '',
          },
        },
      ],
    },
    400,
  )
  await call('PATCH', root + `/accounts/${b.id}`, token, { archived: false })
  const unchanged = await call(
    'GET',
    root + '/statistics?period=year&value=2026',
    token,
  )
  await call('POST', root + `/accounts/${b.id}/reconcile`, token, {
    balance: originalBalance,
    date: d,
    note: '再次核对',
  })
  assert.deepEqual(
    {
      ...(await call(
        'GET',
        root + '/statistics?period=year&value=2026',
        token,
      )),
      revision: 0,
    },
    { ...unchanged, revision: 0 },
  )
  await Promise.all(
    [1, 2].map(() =>
      call('POST', root + `/accounts/${b.id}/reconcile`, token, {
        balance: '80',
        date: d,
        note: '并发盘点',
      }),
    ),
  )
  assert.equal(
    (await call('GET', root + '/accounts', token)).find(
      (r: any) => r.id === b.id,
    ).balance,
    '80.00',
  )
  await call('PATCH', root + '/password', token, {
    accountPassword: 'test123',
    password: 'lock123',
  })
  await call('POST', root + '/batch', editor.token, input, 423)
  await call('POST', root + '/unlock', token, { password: 'lock123' })
  await call('POST', root + '/accounts', token, {
    name: '另一个',
    kind: 'bank',
    openingBalance: '0',
    date: d,
  })
  await call('POST', root + '/unlock', editor.token, { password: 'lock123' })
  // Arbitrary file bytes and multi-image links across every financial record type.
  const binary = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0xFF, 0x81, 0x02])
  const uploadKey = randomUUID()
  const binaryBody = { name: '凭证.zip', base64: binary.toString('base64') }
  const binaryResource = await call(
    'POST',
    root + '/attachment-resources',
    token,
    binaryBody,
    200,
    uploadKey,
  )
  resources.push({ id: binaryResource.id, userId: owner.user.id })
  assert.equal(binaryResource.mimeType, 'application/octet-stream')
  assert.deepEqual(oss.objects.get(binaryResource.path), binary)
  assert.equal(
    (
      await call(
        'POST',
        root + '/attachment-resources',
        token,
        binaryBody,
        200,
        uploadKey,
      )
    ).id,
    binaryResource.id,
  )
  await call(
    'POST',
    root + '/attachment-resources',
    token,
    { name: 'empty', base64: '' },
    400,
  )
  await call(
    'POST',
    root + '/attachment-resources',
    token,
    { name: 'bad', base64: '%%%=' },
    400,
  )
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQZYAAAAASUVORK5CYII='
  const categoryUploadKey = randomUUID()
  const uploadedIcon = await call(
    'POST',
    root + '/category-icons',
    token,
    { base64: png },
    200,
    categoryUploadKey,
  )
  const [storedIcon] = await source.query('SELECT object_path,storage_backend,content FROM ledger_category_icons WHERE id=?', [uploadedIcon.id])
  assert.equal(storedIcon.content, null)
  assert.match(storedIcon.object_path, /^uploads\/resources\/[a-f0-9]{64}$/)
  assert.ok(!storedIcon.object_path.includes(uploadedIcon.id))
  assert.equal(storedIcon.storage_backend, oss.registry.activeId)
  assert.equal(oss.objects.get(storedIcon.object_path)?.toString('base64'), png)
  assert.equal(
    (
      await call(
        'POST',
        root + '/category-icons',
        token,
        { base64: png },
        200,
        categoryUploadKey,
      )
    ).id,
    uploadedIcon.id,
  )
  const picturedCategory = await call(
    'POST',
    root + '/categories',
    token,
    {
      type: 'expense',
      label: '上传图片分类',
      icon: 'other',
      iconId: uploadedIcon.id,
    },
    201,
  )
  assert.equal(picturedCategory.iconId, uploadedIcon.id)
  assert.equal(
    (await call('GET', root + '/categories', token)).find(
      (c: any) => c.id === picturedCategory.id,
    ).iconId,
    uploadedIcon.id,
  )
  assert.equal(
    (
      await call(
        'GET',
        root + `/category-icons/${uploadedIcon.id}`,
        editor.token,
      )
    ).base64,
    png,
  )
  await call(
    'GET',
    root + `/category-icons/${uploadedIcon.id}`,
    outsider.token,
    undefined,
    404,
  )
  await call(
    'POST',
    root + '/category-icons',
    token,
    { base64: Buffer.from('<svg></svg>').toString('base64') },
    400,
  )
  await call('POST', root + '/category-icons', token, { base64: '%%%=' }, 400)
  const anotherBook = books.find((b) => b !== book.id)!
  const foreignIcon = await call(
    'POST',
    `/api/v1/ledgers/${anotherBook}/category-icons`,
    token,
    { base64: png },
  )
  await call(
    'PATCH',
    root + `/categories/${picturedCategory.id}`,
    token,
    { iconId: foreignIcon.id },
    404,
  )
  await call('PATCH', root + `/categories/${picturedCategory.id}`, token, {
    iconId: null,
    icon: 'wallet',
  })
  assert.equal(
    (await call('GET', root + '/categories', token)).find(
      (c: any) => c.id === picturedCategory.id,
    ).iconId,
    null,
  )
  await call(
    'GET',
    root + `/category-icons/${uploadedIcon.id}`,
    editor.token,
    undefined,
    404,
  )
  const pictures = []
  for (let i = 0; i < 2; i++) {
    const resource = await call('POST', root + '/attachment-resources', token, {
      name: `图片${i}.png`,
      base64: png,
    })
    pictures.push(resource.id)
    resources.push({ id: resource.id, userId: owner.user.id })
    assert.equal(resource.mimeType, 'image/png')
  }
  const attachedBill = await call(
    'POST',
    root + '/bills',
    token,
    {
      ...bill('expense', '1', '多附件创建'),
      category: otherExpense.id,
      attachmentResourceIds: [binaryResource.id, ...pictures],
    },
    201,
  )
  const allFiles = await call(
    'GET',
    root + `/records/bill/${attachedBill.id}/attachments`,
    editor.token,
  )
  assert.equal(allFiles.length, 3)
  const downloaded = await call(
    'GET',
    root +
    `/attachments/${allFiles.find((f: any) => f.resourceId === binaryResource.id).id}/content`,
    editor.token,
  )
  assert.ok(Buffer.from(downloaded.base64, 'base64').equals(binary))
  await call(
    'POST',
    root + `/records/bill/${attachedBill.id}/attachments`,
    editor.token,
    { resourceIds: [pictures[0]] },
    403,
  )
  await call(
    'GET',
    root + `/records/bill/${attachedBill.id}/attachments`,
    outsider.token,
    undefined,
    404,
  )
  await call(
    'GET',
    root + `/records/unknown/${attachedBill.id}/attachments`,
    token,
    undefined,
    400,
  )
  const beforeBad = (
    await source.query('SELECT revision FROM ledgers WHERE id=?', [book.id])
  )[0].revision
  const billsBefore = (
    await source.query('SELECT COUNT(*) n FROM bills WHERE ledger_id=?', [
      book.id,
    ])
  )[0].n
  await call(
    'POST',
    root + '/batch',
    token,
    {
      items: [
        {
          kind: 'bill',
          input: {
            ...bill('income', '1', '附件原子回滚'),
            attachmentResourceIds: pictures,
          },
        },
        {
          kind: 'bill',
          input: {
            ...bill('expense', '1', '无效附件'),
            category: otherExpense.id,
            attachmentResourceIds: [randomUUID()],
          },
        },
      ],
    },
    404,
  )
  assert.equal(
    (
      await source.query('SELECT COUNT(*) n FROM bills WHERE ledger_id=?', [
        book.id,
      ])
    )[0].n,
    billsBefore,
  )
  assert.equal(
    (
      await source.query('SELECT revision FROM ledgers WHERE id=?', [book.id])
    )[0].revision,
    beforeBad,
  )
  const foreignResource = await call(
    'POST',
    root + '/attachment-resources',
    editor.token,
    { name: '他人的凭证.bin', base64: binary.toString('base64') },
  )
  resources.push({ id: foreignResource.id, userId: editor.user.id })
  await call(
    'POST',
    root + '/bills',
    token,
    {
      ...bill('expense', '1', '拒绝他人附件'),
      category: otherExpense.id,
      attachmentResourceIds: [foreignResource.id],
    },
    404,
  )
  await call(
    'POST',
    root + '/bills',
    token,
    {
      ...bill('expense', '1', '重复附件'),
      category: otherExpense.id,
      attachmentResourceIds: [pictures[0], pictures[0]],
    },
    400,
  )
  await call(
    'POST',
    root + '/bills',
    token,
    {
      ...bill('expense', '1', '超量附件'),
      category: otherExpense.id,
      attachmentResourceIds: Array.from({ length: 21 }, () => randomUUID()),
    },
    400,
  )
  for (const [kind, table] of Object.entries({
    'debt': 'debt_positions',
    'settlement': 'debt_settlements',
    'refund': 'ledger_refunds',
    'transfer': 'ledger_transfers',
    'reimbursement': 'ledger_reimbursements',
    'reimbursement-receipt': 'ledger_reimbursement_receipts',
    'debt-adjustment': 'ledger_debt_adjustments',
    'account-entry': 'ledger_account_entries',
  })) {
    const [record] = await source.query(
      `SELECT id FROM ${table} WHERE ledger_id=? LIMIT 1`,
      [book.id],
    )
    assert.ok(record, kind)
    const endpoint = root + `/records/${kind}/${record.id}/attachments`
    const k = randomUUID()
    const attached = await call(
      'POST',
      endpoint,
      token,
      { resourceIds: [binaryResource.id, ...pictures] },
      200,
      k,
    )
    assert.equal(attached.length, 3, kind)
    assert.equal(
      (
        await call(
          'POST',
          endpoint,
          token,
          { resourceIds: [binaryResource.id, ...pictures] },
          200,
          k,
        )
      ).length,
      3,
    )
    const visible = await call('GET', endpoint, editor.token)
    assert.equal(visible.length, 3, kind)
    await call(
      'GET',
      root + `/attachments/${visible[0].id}/content`,
      editor.token,
    )
    await call('DELETE', endpoint + `/${visible[0].id}`, token, {})
    assert.equal((await call('GET', endpoint, token)).length, 2)
  }
  const mixedAttachments = await call('POST', root + '/batch', token, {
    items: [
      {
        kind: 'bill',
        ref: 'expense',
        input: {
          ...bill('expense', '10', '整批多附件'),
          category: otherExpense.id,
          attachmentResourceIds: pictures,
        },
      },
      {
        kind: 'debt',
        ref: 'owed',
        input: {
          direction: 'receivable',
          counterparty: '附件测试对象',
          amount: '10',
          date: d,
          dueDate: null,
          note: '',
          cashMovement: false,
          attachmentResourceIds: [binaryResource.id],
        },
      },
      {
        kind: 'settlement',
        input: {
          date: d,
          note: '',
          allocations: [{ debtId: 'ref:owed', amount: '1' }],
          attachmentResourceIds: pictures,
        },
      },
      {
        kind: 'refund',
        input: {
          billId: 'ref:expense',
          amount: '1',
          date: d,
          note: '',
          attachmentResourceIds: [binaryResource.id],
        },
      },
      {
        kind: 'transfer',
        input: {
          fromAccountId: a.id,
          toAccountId: b.id,
          amount: '1',
          date: d,
          note: '',
          attachmentResourceIds: pictures,
        },
      },
    ],
  })
  for (const row of mixedAttachments.items) {
    assert.equal(
      (
        await call(
          'GET',
          root + `/records/${row.kind}/${row.result.id}/attachments`,
          token,
        )
      ).length,
      row.kind === 'debt' || row.kind === 'refund' ? 1 : 2,
    )
  }
  const reimbursementWithFiles = await call(
    'POST',
    root + '/reimbursements',
    token,
    {
      billId: mixedAttachments.items[0].result.id,
      counterparty: '附件测试公司',
      amount: '2',
      attachmentResourceIds: pictures,
    },
  )
  assert.equal(
    (
      await call(
        'GET',
        root +
        `/records/reimbursement/${reimbursementWithFiles.id}/attachments`,
        token,
      )
    ).length,
    2,
  )
  const receiptWithFiles = await call(
    'POST',
    root + `/reimbursements/${reimbursementWithFiles.id}/receipts`,
    token,
    {
      amount: '1',
      date: d,
      note: '',
      attachmentResourceIds: [binaryResource.id],
    },
  )
  assert.equal(
    (
      await call(
        'GET',
        root +
        `/records/reimbursement-receipt/${receiptWithFiles.id}/attachments`,
        token,
      )
    ).length,
    1,
  )
  const adjustmentWithFiles = await call(
    'POST',
    root + `/debts/${mixedAttachments.items[1].result.id}/adjustments`,
    token,
    {
      kind: 'waiver',
      amount: '1',
      date: d,
      note: '附件证明',
      dueDate: null,
      attachmentResourceIds: pictures,
    },
  )
  assert.equal(
    (
      await call(
        'GET',
        root + `/records/debt-adjustment/${adjustmentWithFiles.id}/attachments`,
        token,
      )
    ).length,
    2,
  )
  await call('PATCH', root + `/bills/${attachedBill.id}`, token, {
    attachmentResourceIds: [binaryResource.id],
  })
  assert.equal(
    (
      await call(
        'GET',
        root + `/records/bill/${attachedBill.id}/attachments`,
        token,
      )
    ).length,
    3,
  )
  // Delete/restore a bill keeps evidence, but its files are not served while trashed.
  await call('DELETE', root + `/bills/${attachedBill.id}`, token, {}, 204)
  await call(
    'GET',
    root + `/attachments/${allFiles[0].id}/content`,
    token,
    undefined,
    404,
  )
  await call('POST', root + `/bills/${attachedBill.id}/restore`, token, {})
  assert.equal(
    (
      await call(
        'GET',
        root + `/records/bill/${attachedBill.id}/attachments`,
        token,
      )
    ).length,
    3,
  )
  console.log(
    `Ledger features: ${checks} REST checks; atomic rollback, idempotency, permissions, balances, refunds, reimbursement, imports, worker and 100-row AI consent passed.`,
  )
} finally {
  await app.close()
  for (const r of resources) {
    const actor = users.includes(r.userId)
      ? await source.query(
          'SELECT id,username,nickname,created_at AS createdAt FROM app_users WHERE id=?',
          [r.userId],
        )
      : []
    if (actor.length) {
      await p.resources
        .remove({ user: actor[0], sessionHash: '' }, r.id)
        .catch(() => {})
    }
  }
  for (const id of books) {
    for (const table of [
      'ledger_attachments',
      'ledger_reimbursement_receipts',
      'ledger_reimbursements',
      'ledger_debt_adjustments',
      'ledger_category_recents',
      'ledger_import_drafts',
      'ledger_notices',
      'ledger_rule_runs',
      'ledger_rules',
      'ledger_templates',
      'ledger_budgets',
      'ledger_refunds',
      'ledger_transfers',
      'ledger_account_entries',
      'ledger_accounts',
      'ledger_operations',
      'ledger_audit',
      'ledger_daily_categories',
      'ledger_daily_stats',
      'ledger_events',
      'settlement_allocations',
      'debt_settlements',
      'debt_positions',
      'bills',
      'bill_categories',
      'ledger_category_icons',
      'ledger_unlocks',
      'ledger_invites',
      'ledger_members',
    ]) {
      await source.query(`DELETE FROM ${table} WHERE ledger_id=?`, [id])
    }
    await source.query('DELETE FROM ledgers WHERE id=?', [id])
  }
  for (const id of users) {
    await source.query('DELETE FROM user_sessions WHERE user_id=?', [id])
    await source.query('DELETE FROM app_users WHERE id=?', [id])
  }
  await source.destroy()
}
