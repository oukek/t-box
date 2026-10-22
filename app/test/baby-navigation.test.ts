import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readCareNavigation, showCareNavigation } from '../../apps/baby-diary/web/src/careNavigation'

test('automatic care navigation retires on the second birthday without restricting record access', () => {
  assert.equal(showCareNavigation('auto', '2024-10-21', '2026-10-20'), true)
  assert.equal(showCareNavigation('auto', '2024-10-21', '2026-10-21'), false)
  assert.equal(showCareNavigation('auto', '2019-05-01', '2026-10-21'), false)
  assert.equal(showCareNavigation('auto', null, '2026-10-21'), false)
  assert.equal(showCareNavigation('auto', '2026-10-22', '2026-10-21'), false)
  assert.equal(showCareNavigation('auto', '2024-02-29', '2026-02-27'), true)
  assert.equal(showCareNavigation('auto', '2024-02-29', '2026-02-28'), false)
})
test('personal choices override age and invalid stored values use the automatic policy', () => {
  assert.equal(showCareNavigation('pinned', '2019-01-01', '2026-10-21'), true)
  assert.equal(showCareNavigation('pinned', null, '2026-10-21'), true)
  assert.equal(showCareNavigation('menu', '2026-10-01', '2026-10-21'), false)
  assert.equal(readCareNavigation('pinned'), 'pinned')
  assert.equal(readCareNavigation('menu'), 'menu')
  for (const value of [null, undefined, [], {}, true, 'unknown']) {
    assert.equal(readCareNavigation(value), 'auto')
  }
})
