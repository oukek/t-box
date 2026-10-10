import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calendarCells,
  daysInMonth,
  periodAvailable,
  periodBounds,
} from '@t-box/ui-kit/calendar'
import { categorySlices, trendPoints } from '@t-box/ui-kit/charts/data'

const point = (date: string, income = '0.00', expense = '0.00') => ({
  date,
  income,
  expense,
  cashIn: '0.00',
  cashOut: '0.00',
  receivableChange: '0.00',
  payableChange: '0.00',
  count: 0,
})
test('calendar handles leap years, Sunday-first weeks and date limits', () => {
  assert.equal(daysInMonth(2024, 2), 29)
  assert.equal(daysInMonth(2100, 2), 28)
  const cells = calendarCells(2026, 10)
  assert.equal(cells.length, 42)
  assert.equal(calendarCells(2026, 10, 1)[0]!.key, '2026-09-28')
  assert.equal(cells[0]!.key, '2026-09-27')
  assert.equal(cells[4]!.key, '2026-10-01')
  assert.equal(
    periodAvailable('2026-10-06', 'date', '1900-01-01', '2026-10-05'),
    false,
  )
  assert.equal(
    periodAvailable('2026-09', 'month', '2026-10-05', '9999-12-31'),
    false,
  )
  assert.equal(
    periodAvailable('2026-10', 'month', '2026-10-05', '9999-12-31'),
    true,
  )
  assert.deepEqual(periodBounds('2024-Q1', 'quarter'), [
    '2024-01-01',
    '2024-03-31',
  ])
  assert.deepEqual(periodBounds('9999', 'year'), ['9999-01-01', '9999-12-31'])
})
test('trend keeps empty days and uses exact amounts when grouping weeks/months', () => {
  const series = [
    point('2026-01-01', '0.10'),
    point('2026-01-02', '0.20'),
    point('2026-01-03'),
    point('2026-02-01', '0.30'),
  ]
  assert.equal(trendPoints(series, 'month').length, 4)
  assert.deepEqual(
    trendPoints(series, 'year').map((row) => row.income),
    ['0.30', '0.30'],
  )
  const quarter = trendPoints(
    Array.from({ length: 9 }, (_, i) =>
      point(`2026-01-${String(i + 1).padStart(2, '0')}`, '0.01')),
    'quarter',
  )
  assert.equal(quarter.length, 2)
  assert.equal(quarter[0]!.end, '2026-01-07')
  assert.equal(quarter[0]!.income, '0.07')
  assert.equal(quarter[1]!.income, '0.02')
})
test('pie excludes zero values, groups the tail without losing money and preserves percentages', () => {
  assert.deepEqual(
    categorySlices([{ label: 'zero', amount: '0.00', count: 0 }]),
    [],
  )
  const rows = Array.from({ length: 8 }, (_, i) => ({
    label: `分类${i}`,
    amount: '0.10',
    count: 1,
  }))
  const slices = categorySlices(rows)
  assert.equal(slices.length, 7)
  assert.equal(slices[6]!.amount, '0.20')
  assert.equal(slices[6]!.count, 2)
  assert.equal(
    slices.reduce((sum, row) => sum + row.percentage, 0),
    100,
  )
  assert.equal(
    categorySlices([
      { label: '大额', amount: '9007199254740993.01', count: 1 },
    ])[0]!.amount,
    '9007199254740993.01',
  )
})

test('cash chart keeps borrowed principal separate from ordinary income and expense', () => {
  const row = { ...point('2026-10-04'), cashIn: '1200.00', cashOut: '100.00' }
  assert.equal(trendPoints([row], 'month')[0]!.income, '0.00')
  const cash = trendPoints([row], 'month', 'cash')[0]!
  assert.equal(cash.income, '1200.00')
  assert.equal(cash.expense, '100.00')
})
