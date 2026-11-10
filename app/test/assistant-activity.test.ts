import assert from 'node:assert/strict'
import test from 'node:test'
import { AssistantActivityIndicator } from '../src/features/assistant/activity'

const running = { id: 'task-a', status: 'running', busy: true }
test('unattended AI completion only marks the assistant and opening it clears the mark', () => {
  const indicator = new AssistantActivityIndicator()
  assert.equal(indicator.observe(running, true), false)
  assert.equal(indicator.observe(running, false), false)
  assert.equal(indicator.observe({ ...running, status: 'completed', busy: false }, false), true)
  assert.equal(indicator.observe({ ...running, status: 'completed', busy: false }, true), false)
  assert.equal(indicator.observe({ ...running, status: 'completed', busy: false }, false), false)
})
test('pending confirmation is visible at the AI entry even while the task is busy', () => {
  const indicator = new AssistantActivityIndicator()
  indicator.observe(running, false)
  assert.equal(indicator.observe({ ...running, status: 'waiting_client' }, false), true)
  assert.equal(indicator.observe({ ...running, status: 'waiting_client' }, true), false)
  assert.equal(indicator.observe({ ...running, status: 'waiting_client' }, false), false)
})
test('initial completed history, tool progress and cancelled tasks do not request attention', () => {
  const indicator = new AssistantActivityIndicator()
  assert.equal(indicator.observe({ id: '', status: '', busy: false }, false), false)
  assert.equal(indicator.observe({ ...running, status: 'completed', busy: false }, false), false)
  assert.equal(indicator.observe(running, false), false)
  assert.equal(indicator.observe(running, false), false)
  assert.equal(indicator.observe({ ...running, status: 'cancelled', busy: false }, false), false)
})
test('paused and uncertain tasks remain visible in AI, and account reset discards previous attention', () => {
  const indicator = new AssistantActivityIndicator()
  assert.equal(indicator.observe({ ...running, status: 'needs_review', busy: false }, false), true)
  indicator.reset()
  assert.equal(indicator.observe({ id: '', status: '', busy: false }, false), false)
  assert.equal(indicator.observe({ ...running, status: 'paused', busy: false }, false), true)
})
