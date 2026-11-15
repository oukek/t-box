import type { Route, Settings } from '@t-box/shop-tools-contracts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calculate,
  defaultConfig,
  display,
  newRow,
  newSheet,
  paste,
  shipping,
  validateBook,
} from '../core/src/index.js'

const route: Route = {
  key: 'test',
  site: 'MY',
  siteName: '马来西亚',
  currency: 'MYR',
  cargo: '普货',
  channel: '标准',
  region: '全国',
  path: [],
  label: '测试',
  fees: [
    { type: 'Seller', name: 'Flat', original_fee: 2 },
    { type: 'Buyer', name: 'Flat', original_fee: 3 },
  ],
  exchange: 2,
  commission: 6,
  trade: 2,
}
const settings: Settings = {
  date: '2026-11-15',
  mode: 'profit',
  routeKey: 'test',
}
const row = () => ({
  ...newRow(defaultConfig().basic),
  cost: 100,
  weight: 0.5,
  domestic: 5,
  target: 20,
  discount: 10,
})
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
test('three pricing modes invert each other with fees and FX reserve', () => {
  for (const site of ['MY', 'ID']) {
    const r = { ...route, site, exchange: site === 'ID' ? 2000 : 2 }
    const input = row()
    const a = calculate(input, settings, r)
    near(a.profit, 20)
    assert.equal(display(a.profit), '20.00')
    const b = calculate(
      { ...input, target: a.sale },
      { ...settings, mode: 'price' },
      r,
    )
    near(b.profit, a.profit)
    const c = calculate(
      { ...input, target: a.margin },
      { ...settings, mode: 'profitRate' },
      r,
    )
    near(c.sale, a.sale)
    near(a.price * (1 - 0.1), a.sale)
    if (site === 'ID') {
      assert.equal(a.trade, 3000)
    }
  }
})
test('4 percent reserve grosses up the net settlement', () => {
  const r = { ...route, fees: [], exchange: 1, commission: 0, trade: 0 }
  const a = calculate(
    { ...row(), domestic: 0, activity: 0, withdraw: 0, discount: 0 },
    settings,
    r,
  )
  near(a.sale, 125)
  near(a.loss, 5)
  near(a.profit, 20)
  assert.equal(display(a.profit), '20.00')
})
test('zero reserve is preserved and sale mode allows loss', () => {
  const a = calculate(
    { ...row(), loss: 0, target: 10 },
    { ...settings, mode: 'price' },
    route,
  )
  assert.ok(a.profit < 0)
  assert.equal(a.loss, 0)
})
test('invalid and singular parameters fail before results', () => {
  for (const patch of [
    { weight: 0 },
    { loss: 100 },
    { activity: '' },
    { cost: 'NaN' },
    { target: -1 },
  ]) {
    assert.throws(() => calculate({ ...row(), ...patch }, settings, route))
  }
  assert.throws(() =>
    calculate(
      { ...row(), target: 99 },
      { ...settings, mode: 'profitRate' },
      route,
    ),
  )
})
test('shipping converts kg at call boundary and rounds incremental blocks upward', () => {
  const rules = [
    {
      type: 'Seller' as const,
      name: 'WeightRange' as const,
      start_weight: 0,
      original_fee: 5,
    },
    {
      type: 'Seller' as const,
      name: 'Increment' as const,
      start_weight: 100,
      end_weight: 500,
      increment_unit: 100,
      increment_amount: 2,
    },
  ]
  assert.equal(shipping(100, rules).seller.value, 5)
  assert.equal(shipping(101, rules).seller.value, 7)
  assert.equal(shipping(900, rules).seller.value, 13)
  assert.throws(() =>
    shipping(200, [{ type: 'Seller', name: 'Increment', increment_unit: 0 }]),
  )
})
test('paste grows rows without writing output columns and enforces row limit', () => {
  const rows = [newRow()]
  paste(rows, 0, 0, '001\t测试\t100\t0.5\t5\t20\n002\t第二件', {})
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.sku, '001')
  assert.equal(rows[1]?.name, '第二件')
  assert.throws(() => paste(rows, 999, 0, 'a\nb', {}))
})
test('workbook rejects duplicate ids and invalid mode', () => {
  const s = newSheet('测试')
  const book = { version: 1, activeSheetId: s.id, sheets: [s] }
  assert.equal(validateBook(book).sheets.length, 1)
  assert.throws(() => validateBook({ ...book, sheets: [s, s] }))
  assert.throws(() =>
    validateBook({
      ...book,
      sheets: [{ ...s, settings: { ...s.settings, mode: 'bad' } }],
    }),
  )
})
