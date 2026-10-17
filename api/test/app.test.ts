import type { BillRepository } from '@t-box/ledger-server/repository'
import type { ListFilters } from '@t-box/ledger-server/validation'
import type { Bill, BillInput, BillSummary } from '@t-box/shared'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { centsToDecimal } from '@t-box/ledger-server/repository'
import { monthBounds } from '@t-box/ledger-server/validation'
import { createApp } from '../src/app.js'
import { fakeCategories } from './category-fixture.js'

const validInput: BillInput = { type: 'expense', amount: '32.5', category: 'food', date: '2026-10-04', note: '午餐' }
const zeroSummary: BillSummary = { income: '0.00', expense: '0.00', balance: '0.00', count: 0, categories: [] }

function setup(overrides: Partial<BillRepository> = {}) {
  const rows = new Map<string, Bill>()
  const repository: BillRepository = {
    list: async (_filters: ListFilters) => ({ data: [...rows.values()], total: rows.size }),
    summary: async () => zeroSummary,
    get: async (id) => rows.get(id),
    create: async (input) => {
      const bill: Bill = { id: randomUUID(), ...input, createdAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z' }
      rows.set(bill.id, bill)
      return bill
    },
    update: async (id, patch) => {
      const current = rows.get(id)
      if (!current) {
        return undefined
      }
      const updated = { ...current, ...patch }
      rows.set(id, updated)
      return updated
    },
    delete: async (id) => rows.delete(id),
    ...overrides,
  }
  const app = createApp({ bills: repository, categories: fakeCategories(), health: async () => ({ mysql: 'up', redis: 'down' }) })
  return { app, rows }
}

test('default HTTP and chat connections accept arbitrary origins without enabling ordinary API cookies', async (t) => {
  const { app } = setup()
  t.after(() => app.close())
  const origin = 'https://new-website.example.org'
  const preflight = await app.inject({ method: 'OPTIONS', url: '/api/v1/bills', headers: { 'origin': origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } })
  assert.equal(preflight.statusCode, 204)
  assert.equal(preflight.headers['access-control-allow-origin'], '*')
  assert.equal(preflight.headers['access-control-allow-credentials'], undefined)
  const response = await app.inject({ url: '/api/v1/health', headers: { origin } })
  assert.equal(response.headers['access-control-allow-origin'], '*')
  const socket = await app.injectWS('/api/v1/chat/ws', { headers: { origin } })
  const received = new Promise<string>((resolve) => socket.once('message', (data) => resolve(data.toString())))
  socket.send(JSON.stringify({ type: 'session.open' }))
  assert.equal(JSON.parse(await received).type, 'session.ready')
  socket.terminate()
})

test('REST lifecycle creates, reads, updates, deletes, and reports absent bills', async (t) => {
  const { app } = setup()
  t.after(() => app.close())
  const created = await app.inject({ method: 'POST', url: '/api/v1/bills', payload: validInput })
  assert.equal(created.statusCode, 201)
  const bill = created.json<{ data: Bill }>().data
  assert.equal(bill.amount, '32.50')
  assert.equal(created.headers.location, `/api/v1/bills/${bill.id}`)

  const fetched = await app.inject({ url: `/api/v1/bills/${bill.id}` })
  assert.deepEqual(fetched.json().data, bill)
  const list = await app.inject({ url: '/api/v1/bills' })
  assert.deepEqual(list.json().meta, { page: 1, pageSize: 20, total: 1 })
  const updated = await app.inject({ method: 'PATCH', url: `/api/v1/bills/${bill.id}`, payload: { note: '晚餐', amount: '0.01' } })
  assert.equal(updated.statusCode, 200)
  assert.equal(updated.json().data.amount, '0.01')
  assert.equal(updated.json().data.note, '晚餐')
  assert.equal(updated.json().data.type, 'expense')
  const removed = await app.inject({ method: 'DELETE', url: `/api/v1/bills/${bill.id}` })
  assert.equal(removed.statusCode, 204)
  assert.equal(removed.body, '')
  assert.equal((await app.inject({ url: `/api/v1/bills/${bill.id}` })).statusCode, 404)
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/bills/${bill.id}` })).statusCode, 404)
})

test('rejects invalid money, dates, type/category mismatch, and unknown fields before writing', async (t) => {
  const { app, rows } = setup()
  t.after(() => app.close())
  const cases: Record<string, unknown>[] = [
    { amount: 1.5 },
    { amount: '0' },
    { amount: '-2.00' },
    { amount: '1.234' },
    { amount: '1e2' },
    { amount: '01.00' },
    { amount: '1000000000.00' },
    { amount: 'NaN' },
    { date: '2026-02-29' },
    { date: '2026-04-31' },
    { date: '2026-13-01' },
    { date: '0999-01-01' },
    { type: 'transfer' },
    { category: 'salary' },
    { category: 'unknown' },
    { note: 'a'.repeat(201) },
    { note: null },
    { id: randomUUID() },
  ]
  for (const changes of cases) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/bills', payload: { ...validInput, ...changes } })
    assert.equal(response.statusCode, 400, JSON.stringify(changes))
    assert.equal(response.json().error.code, 'VALIDATION_ERROR')
  }
  const missing = await app.inject({ method: 'POST', url: '/api/v1/bills', payload: { amount: '1.00' } })
  assert.equal(missing.statusCode, 400)
  assert.equal(rows.size, 0)
})

test('accepts leap day and boundary amounts without rounding', async (t) => {
  const { app } = setup()
  t.after(() => app.close())
  for (const amount of ['0.01', '999999999.99', '100.10']) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/bills', payload: { ...validInput, date: '2024-02-29', amount } })
    assert.equal(response.statusCode, 201)
    assert.equal(response.json().data.amount, amount)
  }
  assert.equal(centsToDecimal(-1n), '-0.01')
  assert.equal(centsToDecimal(900719925474099301n), '9007199254740993.01')
  assert.deepEqual(monthBounds('2024-02'), ['2024-02-01', '2024-02-29'])
  assert.deepEqual(monthBounds('2100-02'), ['2100-02-01', '2100-02-28'])
  assert.deepEqual(monthBounds('9999-12'), ['9999-12-01', '9999-12-31'])
})

test('PATCH validates the merged record, including when only type is changed', async (t) => {
  const { app } = setup()
  t.after(() => app.close())
  const created = await app.inject({ method: 'POST', url: '/api/v1/bills', payload: validInput })
  const id = created.json().data.id
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/bills/${id}`, payload: { type: 'income' } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/bills/${id}`, payload: {} })).statusCode, 400)
  const result = await app.inject({ method: 'PATCH', url: `/api/v1/bills/${id}`, payload: { type: 'income', category: 'salary' } })
  assert.equal(result.statusCode, 200)
  assert.equal(result.json().data.category, 'salary')
})

test('PATCH writes type and category together when either changes', async (t) => {
  let received: Partial<BillInput> | undefined
  const { app } = setup({
    update: async (id, patch) => {
      received = patch
      return { id, ...validInput, ...patch, createdAt: '', updatedAt: '' }
    },
  })
  t.after(() => app.close())
  const created = await app.inject({ method: 'POST', url: '/api/v1/bills', payload: { ...validInput, category: 'expense_other' } })
  const id = created.json().data.id
  const result = await app.inject({ method: 'PATCH', url: `/api/v1/bills/${id}`, payload: { type: 'income', category: 'income_other' } })
  assert.equal(result.statusCode, 200)
  assert.deepEqual(received, { type: 'income', category: 'income_other' })
})

test('query filters are validated and passed to the repository without ambiguity', async (t) => {
  let received: ListFilters | undefined
  let receivedMonth: string | undefined
  const { app } = setup({
    list: async (filters) => {
      received = filters
      return { data: [], total: 0 }
    },
    summary: async (month) => {
      receivedMonth = month
      return zeroSummary
    },
  })
  t.after(() => app.close())
  const response = await app.inject({ url: '/api/v1/bills?month=2026-10&type=expense&q=%20coffee%20&page=2&pageSize=10' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(received, { month: '2026-10', type: 'expense', q: 'coffee', page: 2, pageSize: 10 })
  for (const query of ['month=2026-13', 'page=0', 'page=1.5', 'pageSize=101', 'type=other', 'month=2026-10&month=2026-11', 'unknown=x']) {
    assert.equal((await app.inject({ url: `/api/v1/bills?${query}` })).statusCode, 400, query)
  }
  const summary = await app.inject({ url: '/api/v1/bills/summary?month=2026-10' })
  assert.equal(summary.statusCode, 200)
  assert.deepEqual(summary.json().data, zeroSummary)
  assert.equal(receivedMonth, '2026-10')
  assert.equal((await app.inject({ url: '/api/v1/bills/summary?month=wrong' })).statusCode, 400)
})

test('returns stable error envelopes without leaking database errors', async (t) => {
  const { app } = setup({ list: async () => {
    throw new Error('mysql://root:secret@private-host')
  } })
  t.after(() => app.close())
  const result = await app.inject({ url: '/api/v1/bills' })
  assert.equal(result.statusCode, 500)
  assert.equal(result.json().error.code, 'INTERNAL_ERROR')
  assert.ok(!result.body.includes('secret'))
  const malformed = await app.inject({ method: 'POST', url: '/api/v1/bills', headers: { 'content-type': 'application/json' }, payload: '{broken' })
  assert.equal(malformed.statusCode, 400)
  assert.equal(malformed.json().error.code, 'BAD_REQUEST')
  assert.equal((await app.inject({ url: '/api/v1/bills/invalid-id' })).statusCode, 400)
  assert.equal((await app.inject({ url: '/unknown' })).json().error.code, 'NOT_FOUND')
})

test('Redis failure reports degraded health while MySQL failure reports unavailable', async (t) => {
  const { app } = setup()
  const downApp = createApp({ bills: {} as BillRepository, health: async () => ({ mysql: 'down', redis: 'up' }) })
  t.after(async () => {
    await app.close()
    await downApp.close()
  })
  const degraded = await app.inject({ url: '/api/v1/health' })
  assert.equal(degraded.statusCode, 200)
  assert.equal(degraded.json().data.status, 'degraded')
  const unavailable = await downApp.inject({ url: '/api/v1/health' })
  assert.equal(unavailable.statusCode, 503)
  assert.equal(unavailable.json().data.dependencies.mysql, 'down')
})
