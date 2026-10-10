import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateSummary } from '@t-box/ledger-server/repository'

test('summary aggregates exact decimal amounts beyond Number safe precision', async () => {
  const result = aggregateSummary([
    { type: 'expense', category: 'food', amount: '0.10', count: 1 },
    { type: 'expense', category: 'transport', amount: '0.20', count: 1 },
    { type: 'income', category: 'salary', amount: '9007199254740993.01', count: 10_000_000 },
    { type: 'income', category: 'bonus', amount: '0.01', count: 1 },
  ])
  assert.deepEqual(result, {
    income: '9007199254740993.02',
    expense: '0.30',
    balance: '9007199254740992.72',
    count: 10_000_003,
    categories: [{ category: 'transport', amount: '0.20' }, { category: 'food', amount: '0.10' }],
  })
})

test('summary of an empty month is a complete zero-valued response', async () => {
  assert.deepEqual(aggregateSummary([]), {
    income: '0.00',
    expense: '0.00',
    balance: '0.00',
    count: 0,
    categories: [],
  })
})
