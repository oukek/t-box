import assert from 'node:assert/strict'
import { test } from 'node:test'
import { presentApplicationIcon, systemApplicationManifests } from '@t-box/shared'
import { JSDOM } from 'jsdom'
import { effectScope } from 'vue'
import { legacyApplicationIcon as legacyCalendarIcon } from '../../apps/calendar/contracts/src/legacy-icon'
import { clockHandAngles, useLauncherClock } from '../../packages/ui-kit/src/launcherClock'

test('clock hands follow local time including partial hours and minutes', () => {
  assert.deepEqual(clockHandAngles(new Date(2026, 9, 15, 0, 0, 0)), { hour: 0, minute: 0, second: 0 })
  assert.deepEqual(clockHandAngles(new Date(2026, 9, 15, 12, 0, 0)), { hour: 0, minute: 0, second: 0 })
  assert.deepEqual(clockHandAngles(new Date(2026, 9, 15, 3, 15, 30)), { hour: 97.75, minute: 93, second: 180 })
  assert.deepEqual(clockHandAngles(new Date(2026, 9, 15, 23, 59, 59)), { hour: 359.9916666666667, minute: 359.9, second: 354 })
})
test('only known default images are restored; custom and explicit image icons retain their rendering', () => {
  const calendar = systemApplicationManifests.find((m) => m.id === 'calendar')!
  const restored = presentApplicationIcon({ ...calendar, iconVariant: undefined, iconAsset: legacyCalendarIcon })
  assert.equal(restored.iconAsset, calendar.iconAsset)
  assert.equal(restored.iconVariant, 'calendar')
  const custom = { ...calendar, iconVariant: undefined, iconAsset: 'data:image/png;base64,custom' }
  assert.equal(presentApplicationIcon(custom), custom)
  const explicit = { ...calendar, iconVariant: 'image' as const, iconAsset: legacyCalendarIcon }
  assert.equal(presentApplicationIcon(explicit), explicit)
})
test('live icons share a ticker and clean it up on hiding and unmount', (t) => {
  const dom = new JSDOM()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  let starts = 0
  const cleared: unknown[] = []
  t.mock.method(globalThis, 'setInterval', (_callback, delay) => {
    assert.equal(delay, 1000)
    return ++starts as unknown as ReturnType<typeof setInterval>
  })
  t.mock.method(globalThis, 'clearInterval', (id) => {
    if (id !== undefined) {
      cleared.push(id)
    }
  })
  const scope = effectScope()
  try {
    scope.run(() => {
      assert.equal(useLauncherClock(() => true), useLauncherClock(() => true))
      useLauncherClock(() => false)
    })
    assert.equal(starts, 1)
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new dom.window.Event('visibilitychange'))
    assert.deepEqual(cleared, [1])
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new dom.window.Event('visibilitychange'))
    assert.equal(starts, 2)
    scope.stop()
    assert.deepEqual(cleared, [1, 2])
    document.dispatchEvent(new dom.window.Event('visibilitychange'))
    assert.equal(starts, 2)
  } finally {
    scope.stop()
    dom.window.close()
    if (previous) {
      Object.defineProperty(globalThis, 'document', previous)
    } else {
      Reflect.deleteProperty(globalThis, 'document')
    }
  }
})
