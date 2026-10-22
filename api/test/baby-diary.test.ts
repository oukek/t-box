import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import {
  defaultPlayback,
  parseBaby,
  parseFrames,
  parsePlayback,
  parseRecord,
  resolveBabyTheme,
} from '@t-box/baby-diary-contracts'
import {
  babyAge,
  playbackPosition,
  projectFrames,
} from '../../apps/baby-diary/core/src/index.js'

test('baby themes follow sex only in automatic mode and strictly validate the three manual palettes', () => {
  const input = { name: '宝宝', birthDate: null, sex: 'unknown', timezone: 'Asia/Shanghai' }
  assert.equal(resolveBabyTheme('female'), 'pink')
  assert.equal(resolveBabyTheme('male', null), 'blue')
  assert.equal(resolveBabyTheme('unknown', null), 'neutral')
  for (const theme of ['pink', 'blue', 'neutral'] as const) {
    for (const sex of ['female', 'male', 'unknown'] as const) {
      assert.equal(resolveBabyTheme(sex, theme), theme)
      assert.equal(parseBaby({ ...input, sex, theme }).theme, theme)
    }
  }
  assert.equal(parseBaby({ ...input, theme: null }).theme, null)
  assert.equal(Object.hasOwn(parseBaby(input), 'theme'), false, 'older clients must not reset a saved theme')
  for (const theme of ['auto', 'purple', '', 1, {}, []]) {
    assert.throws(() => parseBaby({ ...input, theme }), /主题/)
  }
})

test('baby records validate real dates, explicit units and typed measurement limits', () => {
  const record = {
    kind: 'measurement',
    date: '2026-02-28',
    title: '',
    text: '',
    tags: [],
    assetIds: [],
    visibility: 'members',
    measurement: {
      heightMm: 655,
      weightGrams: 7250,
      headMm: 420,
      method: 'lying',
    },
  }
  assert.equal(parseRecord(record).measurement?.weightGrams, 7250)
  assert.throws(() => parseRecord({ ...record, date: '2026-02-30' }))
  assert.throws(() =>
    parseRecord({
      ...record,
      measurement: { heightMm: 65.5, method: 'lying' },
    }),
  )
  assert.throws(() =>
    parseRecord({ ...record, measurement: { method: 'lying' } }),
  )
  assert.throws(() => parseRecord({ ...record, unexpected: true }))
  assert.throws(() =>
    parseBaby({
      name: '宝宝',
      birthDate: '2199-01-01',
      sex: 'unknown',
      timezone: 'Asia/Shanghai',
    }),
  )
})
test('calendar age handles month boundaries and leap years without 30 day assumptions', () => {
  assert.equal(babyAge('2024-02-29', '2025-02-28'), '1 岁')
  assert.equal(babyAge('2026-01-31', '2026-02-28'), '1 个月')
  assert.equal(babyAge('2026-01-01', '2026-01-02'), '1 天')
  assert.equal(babyAge('2026-01-01', '2025-12-31'), '出生前')
})
test('playback handles cut/fade, fast speed, reverse, looping and final frame', () => {
  const settings = { ...defaultPlayback, frameMs: 1000, transitionMs: 200 }
  assert.deepEqual(playbackPosition(900, 3, settings), {
    index: 0,
    next: 1,
    progress: 0.5,
    done: false,
  })
  assert.equal(
    playbackPosition(900, 3, { ...settings, transition: 'cut' }).progress,
    0,
  )
  assert.equal(playbackPosition(3000, 3, settings).index, 0)
  assert.equal(playbackPosition(0, 3, { ...settings, reverse: true }).index, 2)
  assert.equal(
    playbackPosition(3000, 3, { ...settings, loop: false }).index,
    2,
  )
  assert.equal(
    playbackPosition(3000, 3, { ...settings, loop: false }).done,
    true,
  )
  assert.equal(playbackPosition(20, 0, settings).done, true)
  assert.equal(
    parsePlayback({ ...settings, frameMs: 40, transitionMs: 20 }).frameMs,
    40,
  )
  assert.throws(() =>
    parsePlayback({ ...settings, frameMs: 40, transitionMs: 41 }),
  )
})
test('creative frames enforce unique IDs, safe alignment bounds and preserve chosen order', () => {
  const frame = {
    id: randomUUID(),
    assetId: randomUUID(),
    date: '2026-10-01',
    caption: '',
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
  }
  assert.equal(parseFrames([frame]).length, 1)
  assert.throws(() => parseFrames([frame, frame]))
  assert.throws(() => parseFrames([{ ...frame, scale: Number.NaN }]))
  assert.throws(() => parseFrames([{ ...frame, x: 51 }]))
  const second = { ...frame, id: randomUUID(), date: '2026-10-02' }
  assert.deepEqual(projectFrames([second, frame], '2026-10-02'), [second])
})
