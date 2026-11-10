import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { parseNotificationContent, parseNotificationTarget } from '@t-box/app-contracts'

test('notification targets admit only structured navigation and bounded string parameters', () => {
  const taskId = randomUUID()
  assert.deepEqual(parseNotificationTarget({ type: 'task', taskId }), { type: 'task', taskId })
  assert.deepEqual(parseNotificationTarget({ type: 'application', appId: 'calendar', params: { eventId: taskId, date: '2026-11-02' } }), { type: 'application', appId: 'calendar', params: { eventId: taskId, date: '2026-11-02' } })
  for (const target of [
    { type: 'url', url: 'javascript:alert(1)' },
    { type: 'system', page: 'admin' },
    { type: 'task', taskId, token: 'secret' },
    { type: 'application', appId: '../admin' },
    { type: 'application', appId: 'calendar', params: { nested: {} } },
    { type: 'application', appId: 'calendar', params: { constructor: 'bad' } },
    { type: 'application', appId: 'calendar', params: { value: 'x'.repeat(2001) } },
  ]) {
    assert.throws(() => parseNotificationTarget(target), TypeError)
  }
})

test('notifications reject executable/custom markup fields and invalid media while preserving text as text', () => {
  const content = { style: 'info', title: '<script>alert(1)</script>', actions: [] }
  assert.equal(parseNotificationContent(content).title, content.title)
  assert.throws(() => parseNotificationContent({ ...content, html: '<b>unsafe</b>' }), TypeError)
  assert.throws(() => parseNotificationContent({ ...content, style: 'image', imageResourceId: 'https://example.com/a.png' }), TypeError)
  assert.throws(() => parseNotificationContent({ ...content, style: 'image' }), TypeError)
  assert.throws(() => parseNotificationContent({ ...content, title: 'x'.repeat(101) }), TypeError)
  assert.throws(() => parseNotificationContent({ ...content, actions: Array.from({ length: 4 }, () => ({ label: '打开', target: { type: 'system', page: 'resources' } })) }), TypeError)
})
