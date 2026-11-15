import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calculate,
  defaultConfig,
  metadataOf,
  newRow,
  newSheet,
  validateConfig,
  validatePatch,
} from '../core/src/index.js'

test('workspace writes validate config, metadata, row identifiers and limits on the server boundary', () => {
  const sheet = newSheet('参数')
  const config = defaultConfig()
  const metadata = metadataOf({
    book: { version: 1, activeSheetId: sheet.id, sheets: [sheet] },
    config,
    detail: null,
    comparison: null,
  })
  const base = { revision: 0, metadata, config, upserts: [], removals: [] }
  assert.ok(validatePatch(base))
  for (const basic of [
    { ...config.basic, loss: 100 },
    { ...config.basic, precision: 7 },
    { ...config.basic, activity: '' },
  ]) {
    assert.throws(() => validateConfig({ ...config, basic }))
  }
  assert.throws(() =>
    validatePatch({
      ...base,
      metadata: { ...metadata, activeSheetId: 'missing' },
    }),
  )
  assert.throws(() =>
    validatePatch({
      ...base,
      upserts: [
        {
          sheetId: sheet.id,
          position: 0,
          row: { ...newRow(), id: 'UPPERCASE' },
        },
      ],
    }),
  )
  assert.throws(() =>
    validatePatch({
      ...base,
      upserts: [{ sheetId: sheet.id, position: 1000, row: newRow() }],
    }),
  )
  assert.throws(() =>
    validatePatch({
      ...base,
      upserts: Array.from({ length: 101 }, (_, position) => ({
        sheetId: sheet.id,
        position,
        row: newRow(),
      })),
    }),
  )
})
test('valid result snapshots persist but malformed history is rejected', () => {
  const config = defaultConfig()
  const sheet = newSheet('结果')
  const row = { ...newRow(config.basic), cost: 100, weight: 1, target: 20 }
  const route = {
    key: 'test',
    site: 'MY',
    siteName: '马来西亚',
    currency: 'MYR',
    cargo: '普货',
    channel: '标准',
    region: '全国',
    path: ['normal', 'standard', 'all'],
    label: '测试',
    fees: [],
    exchange: 1,
    commission: 6,
    trade: 2,
  }
  const result = calculate(row, sheet.settings, route)
  const detail = { row, result, route, time: new Date().toISOString() }
  assert.ok(
    validatePatch({
      revision: 1,
      upserts: [],
      removals: [],
      history: { detail, comparison: null },
    }),
  )
  assert.throws(() =>
    validatePatch({
      revision: 1,
      upserts: [],
      removals: [],
      history: { detail: { ...detail, result: {} }, comparison: null },
    }),
  )
  assert.throws(() =>
    validatePatch({
      revision: 1,
      upserts: [],
      removals: [],
      history: {
        detail: { ...detail, route: { ...route, path: [] } },
        comparison: null,
      },
    }),
  )
})
