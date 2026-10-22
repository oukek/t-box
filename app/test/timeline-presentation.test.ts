import type { ChatMessage, ChatTimelineItem } from '@t-box/shared'
import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, nextTick, reactive } from 'vue'
import { useTimelinePresentation } from '../src/features/chat/useTimelinePresentation.js'

const text = (id: string, sequence: number, kind: 'analysis' | 'answer' | 'notice', status: 'completed' | 'streaming' | 'interrupted' = 'completed'): ChatTimelineItem => ({
  id,
  sequence,
  kind,
  text: id,
  status,
  revision: 0,
  createdAt: 'now',
})
const message = (): ChatMessage => ({
  id: 'message',
  role: 'assistant',
  content: '',
  createdAt: 'now',
  toolCalls: [],
  outcome: 'running',
  timeline: [text('analysis', 1, 'analysis', 'streaming')],
})
test('running process can fold; deltas and completion preserve manual choice; retry expands afresh', async () => {
  const props = reactive({ message: message(), active: true })
  const scope = effectScope()
  const view = scope.run(() => useTimelinePresentation(props))!
  try {
    assert.equal(view.expanded.value, true)
    assert.equal(view.process.value.length, 1)
    view.toggle()
    assert.equal(view.visible.value.length, 0)
    props.message.timeline!.push(text('answer', 2, 'answer', 'streaming'))
    await nextTick()
    assert.equal(view.expanded.value, false)
    assert.deepEqual(view.visible.value.map((item) => item.id), ['answer'])
    view.toggle()
    props.message.timeline![1] = text('answer', 2, 'answer')
    props.active = false
    props.message.outcome = 'completed'
    await nextTick()
    assert.equal(view.expanded.value, true, 'finishing cannot override an explicit expansion')
    view.toggle()
    props.active = true
    props.message.outcome = 'running'
    await nextTick()
    assert.equal(view.expanded.value, true, 'resumed execution opens the process by default')
  } finally {
    scope.stop()
  }
})
test('successful completion folds automatically, while failure and pause remain manually foldable with visible error', async () => {
  for (const outcome of ['completed', 'failed', 'paused', 'cancelled'] as const) {
    const props = reactive({ message: message(), active: false })
    props.message.outcome = outcome
    props.message.timeline!.push(text('result', 2, outcome === 'completed' ? 'answer' : 'notice'))
    const scope = effectScope()
    const view = scope.run(() => useTimelinePresentation(props))!
    try {
      assert.equal(view.expanded.value, outcome !== 'completed')
      if (view.expanded.value) {
        view.toggle()
      }
      assert.deepEqual(view.visible.value.map((item) => item.id), ['result'])
      assert.equal(view.process.value.length, 1)
      view.toggle()
      assert.equal(view.visible.value.length, 2)
      // History snapshot replacement must not reset a user's expanded state.
      props.message = structuredClone({ ...message(), outcome, timeline: [...props.message.timeline!.map((item) => ({ ...item }))] })
      await nextTick()
      assert.equal(view.expanded.value, true)
    } finally {
      scope.stop()
    }
  }
})
