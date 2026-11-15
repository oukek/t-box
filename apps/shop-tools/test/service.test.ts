import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDataService } from '../server/src/data.js'

test('Wise requests deduplicate, cache and retain source timestamp', async () => {
  let calls = 0
  const service = createDataService(async (input) => {
    calls++
    const target = new URL(String(input)).searchParams.get('target')
    return Response.json({ source: 'CNY', target, value: 2, time: 100000 })
  })
  const [a, b] = await Promise.all([
    service.invoke('rates', {}),
    service.invoke('rates', {}),
  ])
  assert.deepEqual(a, b)
  assert.equal(calls, 12)
  await service.invoke('rates', {})
  assert.equal(calls, 12)
  assert.equal(
    (a as { updatedAt: string }).updatedAt,
    new Date(100000).toISOString(),
  )
})
test('invalid quote does not poison cache; retry can succeed', async () => {
  let invalid = true
  const service = createDataService(async (input) =>
    Response.json({
      source: 'CNY',
      target: new URL(String(input)).searchParams.get('target'),
      value: invalid ? 0 : 2,
      time: 100000,
    }),
  )
  await assert.rejects(() => service.invoke('rates', {}))
  invalid = false
  await service.invoke('rates', {})
})
test('service only calls fixed upstream URLs and validates dates', async () => {
  const urls: string[] = []
  const service = createDataService(async (input) => {
    urls.push(String(input))
    return Response.json({
      data: String(input).includes('site-config') ? { site_info: [] } : [],
    })
  })
  await assert.rejects(() => service.invoke('https://evil.test', {}))
  await assert.rejects(() => service.invoke('sites', { date: '../x' }))
  await service.invoke('sites', { date: '2026-11-15' })
  assert.equal(urls.length, 2)
  assert.ok(urls.every((u) => u.startsWith('https://solutions.shopee.cn/')))
})
