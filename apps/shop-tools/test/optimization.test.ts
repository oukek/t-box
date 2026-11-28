import type { CatalogContent, OptimizationJob } from '@t-box/shop-tools-contracts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogMedia, optimizationContent, optimizationSlots, parseCatalogContent, selectOptimization } from '../core/src/index.js'

const source: CatalogContent = { title: '杯子', description: '事实', images: ['https://example.com/main.jpg', 'https://example.com/detail.jpg'], videos: ['https://example.com/video.mp4'], skus: ['red', 'blue'].map((id) => ({ id, name: id, code: id, sourceSkuId: 'source-' + id, images: [`https://example.com/${id}.jpg`], cost: 10, price: null, currency: 'MYR', pricing: null })) }
test('stable identities survive image reordering, deletion and insertion without collisions', () => {
  const content = structuredClone(source)
  content.media = catalogMedia(content)
  const detail = content.media[1]!.id
  content.images.reverse()
  content.skus.reverse()
  assert.equal(catalogMedia(content)[0]!.id, detail)
  content.images = ['https://example.com/new.jpg', content.images[0]!]
  const media = catalogMedia(content)
  assert.equal(media[1]!.id, detail)
  assert.equal(new Set(media.map((a) => a.id)).size, media.length)
  assert.equal(media.find((a) => a.url.endsWith('blue.jpg'))!.skuId, 'blue')
})
test('full-product result maps by ids and removes SKU assets without changing source, prices or video', () => {
  const choices = Object.fromEntries(optimizationSlots(source).map((s) => [s.id, { mode: s.skuId === 'red' ? 'remove' : 'optimize' }]))
  const slots = selectOptimization(source, choices)
  const job = { snapshot: { source: structuredClone(source), slots }, results: Object.fromEntries([...slots].reverse().filter((s) => s.mode === 'optimize').map((s) => [s.id, s.kind === 'text' ? { status: 'complete', text: 'Translated ' + s.text } : { status: 'complete', fileId: 'file-' + s.id }])) } as OptimizationJob
  const result = optimizationContent(job, { title: 'Edited' })
  assert.equal(result.title, 'Edited')
  assert.equal(result.skus.length, 1)
  assert.equal(result.skus[0]!.id, 'blue')
  assert.equal(result.skus[0]!.cost, 10)
  assert.equal(result.skus[0]!.code, 'blue')
  assert.equal(result.media!.find((a) => a.skuId === 'blue')!.fileId, 'file-image:blue:0')
  assert.ok(result.media!.every((a) => a.skuId !== 'red'))
  assert.deepEqual(result.videos, source.videos)
  assert.equal(source.skus.length, 2)
  assert.equal(parseCatalogContent(result, 'MYR').media!.length, 3)
  assert.throws(() => optimizationContent(job, { 'sku:unknown': 'tampered' }))
  job.results.title = { status: 'failed' }
  assert.throws(() => optimizationContent(job, {}))
})
test('reject invalid selections, duplicate image ids and foreign SKU association', () => {
  const choices = Object.fromEntries(optimizationSlots(source).map((s) => [s.id, { mode: 'remove' }]))
  assert.throws(() => selectOptimization(source, choices))
  assert.throws(() => selectOptimization(source, {}))
  const media = catalogMedia(source)
  assert.throws(() => parseCatalogContent({ ...source, media: [media[0]!, media[0]!] }, 'MYR'))
  assert.throws(() => parseCatalogContent({ ...source, media: [{ ...media[0]!, skuId: 'missing' }] }, 'MYR'))
})
