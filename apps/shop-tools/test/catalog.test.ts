import type { CatalogContent, CollectedProduct, Route } from '@t-box/shop-tools-contracts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculate, defaultConfig, newRow, parseCatalogContent, parseCollected } from '../core/src/index.js'

const source: CollectedProduct = { id: 'id', platform: '1688', platformName: '1688', sourceId: 'source', sourceUrl: 'https://example.com/item', title: '商品', description: '描述', capturedAt: '2026-11-27', price: { amount: '12', currency: 'CNY' }, assets: [], attributes: [], packaging: [], variants: [] }
test('collection whitelist strips unrelated data and rejects executable URLs or oversized SKU lists', () => {
  assert.deepEqual(parseCollected({ ...source, cookies: 'private', sourceData: [{ account: 'private' }] }), source)
  assert.throws(() => parseCollected({ ...source, sourceUrl: 'javascript:alert(1)' }))
  assert.throws(() => parseCollected({ ...source, variants: Array.from({ length: 1001 }).fill({}) }))
})
test('pricing snapshot must match currency, original cost and recomputed sale price', () => {
  const row = { ...newRow(defaultConfig().basic), id: 'sku', cost: 18, domestic: 3, weight: 0.5, target: 10 }
  const settings = { date: '2026-11-27', routeKey: 'my', mode: 'profit' as const }
  const route: Route = { key: 'my', site: 'MY', siteName: '马来西亚', currency: 'MYR', cargo: '', channel: '', region: '', label: '', path: [], fees: [{ type: 'Seller', name: 'Flat', original_fee: 4 }], exchange: 0.65, commission: 6, trade: 2 }
  const result = calculate(row, settings, route)
  const content: CatalogContent = { title: '商品', description: '', images: [], skus: [{ id: 'sku', code: '', name: '白色', sourceSkuId: 'origin', cost: 18, currency: 'MYR', price: result.price, pricing: { sheetId: 'sheet', sheetName: '方案', row, settings, route, result, time: '' } }] }
  assert.equal(parseCatalogContent(content, 'MYR').skus[0]!.price, result.price)
  assert.throws(() => parseCatalogContent(content, 'THB'))
  const stale = structuredClone(content)
  stale.skus[0]!.cost = 20
  assert.throws(() => parseCatalogContent(stale, 'MYR'))
  const tampered = structuredClone(content)
  tampered.skus[0]!.price = 1
  assert.throws(() => parseCatalogContent(tampered, 'MYR'))
  assert.throws(() => parseCatalogContent({ ...content, skus: [content.skus[0], content.skus[0]] }, 'MYR'))
})
