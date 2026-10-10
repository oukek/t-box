import type { ChatMessage } from '@t-box/shared'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkpointExecution,
  finishExecution,
  startExecution,
} from '../src/agent/execution-time.js'

const message = (): ChatMessage => ({
  id: 'a',
  role: 'assistant',
  createdAt: '2026-10-07T00:00:00.000Z',
  content: '',
  toolCalls: [],
})
test('execution time persists active segments and excludes pauses across resume', () => {
  const m = message()
  const start = Date.parse(m.createdAt)
  startExecution(m, start)
  checkpointExecution(m, start + 1200)
  assert.equal(m.execution!.durationMs, 1200)
  finishExecution(m, start + 2300)
  assert.equal(m.execution!.durationMs, 2300)
  assert.equal(m.execution!.activeSince, undefined)
  assert.ok(m.execution!.finishedAt)
  startExecution(m, start + 600000)
  assert.equal(m.execution!.startedAt, m.createdAt)
  assert.equal(m.execution!.finishedAt, undefined)
  finishExecution(m, start + 603400)
  assert.equal(m.execution!.durationMs, 5700)
})
test('resume discards an unknown crashed interval and keeps the last checkpoint duration', () => {
  const m = message()
  const start = Date.parse(m.createdAt)
  startExecution(m, start)
  checkpointExecution(m, start + 8000)
  const restored = structuredClone(m)
  startExecution(restored, start + 600000)
  finishExecution(restored, start + 602000)
  assert.equal(restored.execution!.durationMs, 10000)
})
