import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  moveDesktopApp,
  profileManifest,
  reconcileDesktopOrder,
  systemApplicationManifests,
} from '@t-box/shared'

test('desktop reconciles installation changes without losing the user\'s order', () => {
  assert.deepEqual(
    reconcileDesktopOrder(
      ['time', 'removed', 'ledger', 'time'],
      ['ledger', 'calendar', 'time', 'profile'],
    ),
    ['time', 'ledger', 'calendar', 'profile'],
  )
})
test('moving an icon preserves exactly the installed applications', () => {
  const initial = ['ledger', 'calendar', 'time', 'profile']
  assert.deepEqual(moveDesktopApp(initial, 'profile', 'calendar'), [
    'ledger',
    'profile',
    'calendar',
    'time',
  ])
  assert.deepEqual(moveDesktopApp(initial, 'ledger', 'profile'), [
    'calendar',
    'time',
    'profile',
    'ledger',
  ])
  assert.deepEqual(moveDesktopApp(initial, 'missing', 'profile'), initial)
  assert.deepEqual(initial, ['ledger', 'calendar', 'time', 'profile'])
})
test('the desktop includes an application without AI skills', () => {
  assert.ok(systemApplicationManifests.includes(profileManifest))
  assert.deepEqual(profileManifest.skillIds, [])
})
