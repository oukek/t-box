import type { ReminderItem } from '@t-box/shared'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeReminderSources, planReminders } from '../../packages/device-reminders/src/planner'

const item = (appId: string, key: string): ReminderItem => ({ key, title: key, body: key, at: '2099-01-01T00:00:00Z', destination: { appId, params: {} } })
test('an unavailable calendar preserves its previous alarms while time can update', () => {
  const calendar = item('calendar', 'calendar-1')
  const timer = item('time', 'timer-new')
  const previous = { owner: 'a', notifications: [{ ...calendar, id: 1900000001 }, { ...item('time', 'timer-old'), id: 1900000002 }] }
  const merged = mergeReminderSources('a', [{ appId: 'calendar', items: null }, { appId: 'time', items: [timer] }], [], previous)
  assert.deepEqual(merged.map((i) => i.key), ['calendar-1', 'timer-new'])
  const planned = planReminders('a', merged, previous, [1900000001, 1900000002], Date.now())
  assert.ok(!planned.cancel.includes(1900000001))
  assert.ok(planned.cancel.includes(1900000002))
})
test('an authoritative empty source clears its alarms; foreign account backup is ignored', () => {
  const previous = { owner: 'a', notifications: [{ ...item('calendar', 'old'), id: 1900000001 }] }
  assert.deepEqual(mergeReminderSources('a', [{ appId: 'calendar', items: [] }], [], previous), [])
  assert.deepEqual(mergeReminderSources('b', [{ appId: 'calendar', items: null }], [], previous), [])
})
