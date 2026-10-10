import type { HolidayDataset } from '@t-box/calendar-contracts'
import assert from 'node:assert/strict'
import { registerHolidayAdministration } from '@t-box/calendar-server/holiday-admin-routes'
import {
  HolidayAuditEntity,
  HolidayYearEntity,
} from '@t-box/calendar-server/holiday-entity'
import { HolidayService } from '@t-box/calendar-server/holiday-service'
import Fastify from 'fastify'
import { createDataSource } from '../src/db/data-source.js'

const source = await createDataSource().initialize()
const candidates = Array.from({ length: 10 }, (_, i) => 2090 + i)
const repo = source.getRepository(HolidayYearEntity)
const used = await repo.find()
const year = candidates.find((y) => !used.some((row) => row.year === y))
if (!year) {
  throw new Error(
    'No unused holiday fixture year; refusing to alter existing data',
  )
}
let calls = 0
let failure = false
let placeholder = false
let automatic = true
const data: HolidayDataset = {
  year,
  papers: ['https://www.gov.cn/fixture-calendar-holiday.htm'],
  days: ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'].map(
    (name, i) => ({
      name,
      date: `${year}-${String(i + 1).padStart(2, '0')}-01`,
      status: 'rest' as const,
    }),
  ),
}
class FixtureService extends HolidayService {
  override async settings() {
    return { enabled: true, autoPublish: automatic }
  }
}
const service = new FixtureService(source, async () => {
  calls++
  if (failure) {
    throw new Error('fixture upstream unavailable')
  }
  if (placeholder) {
    return null
  }
  return structuredClone(data)
})
async function readYear() {
  const snapshot = await service.getYear(year)
  // getYear starts background synchronization; settle it before changing fixture modes.
  await service.sync(year)
  return snapshot
}
const app = Fastify()
app.addHook('preHandler', async (req) => {
  if (req.headers['x-fixture-admin'] !== '1') {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
  }
})
registerHolidayAdministration(app, service, async () => ({
  id: 'fixture-admin',
}))
try {
  await Promise.all([service.sync(year), service.sync(year)])
  assert.equal(calls, 1)
  const initial = await readYear()
  assert.ok(initial.data)
  assert.equal(initial.revision, 1)
  await service.sync(year)
  assert.equal(calls, 1) // Daily throttle.
  failure = true
  await service.sync(year, true)
  assert.deepEqual((await readYear()).data, initial.data)
  placeholder = true
  failure = false
  await service.sync(year, true)
  assert.ok((await readYear()).data)
  placeholder = false
  const draft = structuredClone(data)
  draft.days[0]!.name = '元旦（人工校对）'
  const edited = await service.edit(year, 1, draft, 'draft', 'fixture-admin')
  assert.equal(edited.manual, true)
  assert.deepEqual(edited.data, initial.data)
  await service.sync(year, true)
  assert.deepEqual(
    (await service.list()).find((y) => y.year === year)!.candidate,
    draft,
  )
  await assert.rejects(
    service.edit(year, 1, null, 'publish', 'fixture-admin'),
    /刷新/,
  )
  const published = await service.edit(
    year,
    edited.revision,
    null,
    'publish',
    'fixture-admin',
  )
  assert.equal(published.data!.days[0]!.name, '元旦（人工校对）')
  await service.edit(
    year,
    published.revision,
    null,
    'automatic',
    'fixture-admin',
  )
  automatic = false
  await service.sync(year, true)
  const pending = (await service.list()).find((y) => y.year === year)!
  assert.equal(pending.candidate!.days[0]!.name, '元旦')
  assert.equal(pending.data!.days[0]!.name, '元旦（人工校对）')
  const denied = await app.inject({ method: 'GET', url: '/calendar/holidays' })
  assert.equal(denied.statusCode, 401)
  const listed = await app.inject({
    method: 'GET',
    url: '/calendar/holidays',
    headers: { 'x-fixture-admin': '1' },
  })
  assert.equal(listed.statusCode, 200)
  assert.ok(
    listed.json().data.years.some((y: { year: number }) => y.year === year),
  )
  const invalid = await app.inject({
    method: 'POST',
    url: '/calendar/holiday-years/9999/sync',
    headers: { 'x-fixture-admin': '1' },
    payload: {},
  })
  assert.equal(invalid.statusCode, 400)
  assert.ok((await service.audit(year)).length >= 4)
  console.log(
    'Holiday MySQL publication, synchronization throttle, failure retention, manual protection, optimistic revision, adjacent data and admin routes passed.',
  )
} finally {
  await service.stop()
  await app.close()
  await repo.delete({ region: 'CN', year })
  await source.getRepository(HolidayAuditEntity).delete({ year })
  await source.destroy()
}
