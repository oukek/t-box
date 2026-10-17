import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createCategoryRepository } from '@t-box/ledger-server/categories/repository'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { createApp } from '../src/app.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'

const source = createDataSource()
await source.initialize()
const p = new PlatformService(source)
const app = createApp({
  logger: { level: 'error' },
  platform: p,
  bills: createBillRepository(source),
  categories: createCategoryRepository(source),
  health: async () => ({ mysql: 'up', redis: 'disabled' }),
})
const users: string[] = []
const books: string[] = []
let checked = 0
async function call(
  method: any,
  url: string,
  token = '',
  body?: unknown,
  status = 200,
  key = randomUUID(),
) {
  const result = await app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'idempotency-key': key,
    },
    ...(body === undefined ? {} : { payload: body as any }),
  })
  assert.equal(result.statusCode, status, `${method} ${url}: ${result.body}`)
  checked++
  return result.statusCode === 204 ? null : result.json()
}
try {
  const actors = []
  for (let i = 0; i < 3; i++) {
    const result = await call(
      'POST',
      '/api/v1/auth/register',
      '',
      {
        username: `test_${randomUUID().replaceAll('-', '')}`,
        password: 'test123',
        nickname: `测试${i}`,
      },
      201,
    )
    actors.push(result.data)
    users.push(result.data.user.id)
    const list = await call('GET', '/api/v1/ledgers', result.data.token)
    books.push(...list.data.map((row: any) => row.id))
  }
  const [a, b, c] = actors
  const book = (
    await call(
      'POST',
      '/api/v1/ledgers',
      a.token,
      { name: '集成测试综合账本', template: 'combined' },
      201,
    )
  ).data
  books.push(book.id)
  assert.equal(book.hasPassword, false)
  assert.equal(book.locked, false)
  const base = `/api/v1/ledgers/${book.id}`
  await call('GET', `${base}/statistics`, '', undefined, 401)
  await call('GET', `${base}/statistics`, b.token, undefined, 404)
  await call('GET', '/api/v1/bills', a.token, undefined, 404)
  const categories = (await call('GET', `${base}/categories`, a.token)).data
  const expense = categories.find((row: any) => row.type === 'expense')
  const idem = randomUUID()
  const billInput = {
    type: 'expense',
    amount: '35',
    category: expense.id,
    date: '2026-01-03',
    note: '买菜',
  }
  const bill = (
    await call('POST', `${base}/bills`, a.token, billInput, 201, idem)
  ).data
  assert.equal(
    (await call('POST', `${base}/bills`, a.token, billInput, 201, idem)).data
      .id,
    bill.id,
  )
  await call(
    'POST',
    `${base}/bills`,
    a.token,
    { ...billInput, amount: '36' },
    409,
    idem,
  )
  const debt = (
    await call(
      'POST',
      `${base}/debts`,
      a.token,
      {
        direction: 'receivable',
        counterparty: '张三',
        amount: '1000',
        date: '2026-01-01',
        dueDate: null,
        note: '借出本金',
        cashMovement: true,
      },
      201,
    )
  ).data
  const payable = (
    await call(
      'POST',
      `${base}/debts`,
      a.token,
      {
        direction: 'payable',
        counterparty: '李四',
        amount: '800',
        date: '2026-01-02',
        dueDate: null,
        note: '补录',
        cashMovement: false,
      },
      201,
    )
  ).data
  const collection = (
    await call(
      'POST',
      `${base}/settlements`,
      a.token,
      {
        date: '2026-02-02',
        note: '收到部分还款',
        allocations: [{ debtId: debt.id, amount: '300' }],
      },
      201,
    )
  ).data
  await call(
    'POST',
    `${base}/settlements`,
    a.token,
    {
      date: '2026-02-02',
      note: '超额',
      allocations: [{ debtId: debt.id, amount: '701' }],
    },
    409,
  )
  await call(
    'POST',
    `${base}/settlements`,
    a.token,
    {
      date: '2026-02-02',
      note: '混方向',
      allocations: [
        { debtId: debt.id, amount: '1' },
        { debtId: payable.id, amount: '1' },
      ],
    },
    400,
  )
  const january = (
    await call('GET', `${base}/statistics?period=month&value=2026-01`, a.token)
  ).data
  assert.equal(january.expense, '35.00')
  assert.equal(january.income, '0.00')
  assert.equal(january.cashOut, '1035.00')
  assert.equal(january.closingReceivable, '1000.00')
  assert.equal(january.currentReceivable, '700.00')
  assert.equal(january.closingPayable, '800.00')
  const february = (
    await call('GET', `${base}/statistics?period=month&value=2026-02`, a.token)
  ).data
  assert.equal(february.openingReceivable, '1000.00')
  assert.equal(february.closingReceivable, '700.00')
  assert.equal(february.cashIn, '300.00')
  assert.equal(february.income, '0.00')
  await call('PATCH', `${base}/bills/${bill.id}`, a.token, {
    date: '2026-02-03',
    amount: '40',
  })
  assert.equal(
    (
      await call(
        'GET',
        `${base}/statistics?period=day&value=2026-01-03`,
        a.token,
      )
    ).data.expense,
    '0.00',
  )
  assert.equal(
    (
      await call(
        'GET',
        `${base}/statistics?period=quarter&value=2026-Q1`,
        a.token,
      )
    ).data.expense,
    '40.00',
  )
  assert.equal(
    (await call('GET', `${base}/statistics?period=year&value=2026`, a.token))
      .data.series.length,
    365,
  )
  await call(
    'POST',
    `${base}/settlements/${collection.id}/reversal`,
    a.token,
    {},
  )
  assert.equal(
    (
      await call(
        'GET',
        `${base}/statistics?period=month&value=2026-02`,
        a.token,
      )
    ).data.currentReceivable,
    '1000.00',
  )
  const live = await app.injectWS('/api/v1/ledgers/ws', {
    headers: { origin: 'https://new-ledger.example.org' },
  })
  const liveEvents: any[] = []
  live.on('message', (raw) => liveEvents.push(JSON.parse(raw.toString())))
  async function liveWait(type: string, after = 0) {
    for (let i = 0; i < 200; i++) {
      const event = liveEvents.slice(after).find((row) => row.type === type)
      if (event) {
        return event
      }
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error(`No live ${type}`)
  }
  live.send(JSON.stringify({ type: 'authenticate', token: a.token }))
  await liveWait('ready')
  live.send(JSON.stringify({ type: 'subscribe', ledgerId: book.id }))
  const firstLive = await liveWait('ledger.changed')
  const liveMark = liveEvents.length
  const liveBill = (
    await call(
      'POST',
      `${base}/bills`,
      a.token,
      { ...billInput, amount: '1' },
      201,
    )
  ).data
  const change = await liveWait('ledger.changed', liveMark)
  assert(change.revision > firstLive.revision)
  await call('DELETE', `${base}/bills/${liveBill.id}`, a.token, undefined, 204)
  const invite = (
    await call(
      'POST',
      `${base}/invites`,
      a.token,
      { role: 'editor', maxUses: 1, days: 1 },
      201,
    )
  ).data
  await call('POST', '/api/v1/ledger-invitations/accept', b.token, {
    token: invite.token,
  })
  await call('POST', '/api/v1/ledger-invitations/accept', b.token, {
    token: invite.token,
  })
  await call(
    'POST',
    '/api/v1/ledger-invitations/accept',
    c.token,
    { token: invite.token },
    400,
  )
  await call(
    'PATCH',
    `${base}/bills/${bill.id}`,
    b.token,
    { amount: '1' },
    403,
  )
  await call('PATCH', `${base}/members/${b.user.id}`, a.token, {
    role: 'viewer',
  })
  await call('POST', `${base}/bills`, b.token, billInput, 403)
  await call('PATCH', `${base}/password`, a.token, {
    accountPassword: 'test123',
    password: 'lock123',
  })
  assert.equal((await liveWait('ledger.revoked')).code, 'LEDGER_LOCKED')
  live.terminate()
  await call('GET', `${base}/statistics`, a.token, undefined, 423)
  await call('GET', `${base}/debts`, b.token, undefined, 423)
  await call('POST', `${base}/unlock`, a.token, { password: 'bad' }, 403)
  assert.equal(
    (await call('POST', `${base}/unlock`, a.token, { password: 'lock123' }))
      .data.locked,
    false,
  )
  await call('POST', `${base}/unlock`, b.token, { password: 'lock123' })
  await call('PATCH', `${base}/password`, a.token, {
    accountPassword: 'test123',
    password: 'lock456',
  })
  await call('GET', `${base}/statistics`, b.token, undefined, 423)
  await call('POST', `${base}/unlock`, a.token, { password: 'lock456' })
  const before = (
    await call('GET', `${base}/statistics?period=year&value=2026`, a.token)
  ).data
  await call('POST', `${base}/statistics/rebuild`, a.token, {})
  const after = (
    await call('GET', `${base}/statistics?period=year&value=2026`, a.token)
  ).data
  assert.deepEqual({ ...before, revision: 0 }, { ...after, revision: 0 })
  await call('DELETE', `${base}/members/${b.user.id}`, a.token)
  await call('GET', `${base}/statistics`, b.token, undefined, 404)
  const debt2 = (
    await call(
      'POST',
      `${base}/debts`,
      a.token,
      {
        direction: 'receivable',
        counterparty: '张三',
        amount: '100',
        date: '2026-01-01',
        dueDate: null,
        note: '并发结算',
        cashMovement: false,
      },
      201,
    )
  ).data
  const concurrent = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: 'POST',
        url: `${base}/settlements`,
        headers: {
          'authorization': `Bearer ${a.token}`,
          'idempotency-key': randomUUID(),
        },
        payload: {
          date: '2026-02-01',
          note: '并发',
          allocations: [{ debtId: debt2.id, amount: '80' }],
        },
      }),
    ),
  )
  assert.deepEqual(concurrent.map((r) => r.statusCode).sort(), [201, 409])
  await call('DELETE', `${base}/bills/${bill.id}`, a.token, undefined, 204)
  assert.equal(
    (await call('GET', `${base}/statistics?period=year&value=2026`, a.token))
      .data.expense,
    '0.00',
  )
  await call('DELETE', '/api/v1/auth/session', a.token, undefined, 204)
  await call('GET', base, a.token, undefined, 401)
  console.log(
    `Shared ledgers: ${checked} REST checks + balance, rebuild and concurrent settlement assertions passed.`,
  )
} finally {
  await app.close()
  for (const id of books) {
    for (const table of [
      'ledger_category_recents',
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
