import type { ChatMessage, ChatTimelineItem } from '@t-box/shared'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyTimelineDelta,
  applyTimelineItem,
} from '../src/features/chat/timelineReducer.js'

test('ordered deltas reject duplicates/gaps and full updates reconcile without moving a tool', () => {
  const message: ChatMessage = {
    id: 'a',
    role: 'assistant',
    content: '',
    createdAt: 'now',
    toolCalls: [],
  }
  const text: ChatTimelineItem = {
    id: 'text',
    sequence: 1,
    revision: 0,
    createdAt: 'now',
    kind: 'reasoning',
    text: '',
    status: 'streaming',
  }
  applyTimelineItem(message, text)
  applyTimelineDelta(message, 'text', 1, '先查')
  applyTimelineDelta(message, 'text', 1, '重复')
  applyTimelineDelta(message, 'text', 3, '缺失')
  assert.equal(
    message.timeline![0]!.kind !== 'tool' && message.timeline![0]!.text,
    '先查',
  )
  applyTimelineItem(message, {
    ...text,
    revision: 4,
    text: '先查记录',
    status: 'completed',
  })
  const tool: ChatTimelineItem = {
    id: 'tool:read',
    sequence: 2,
    revision: 0,
    createdAt: 'now',
    kind: 'tool',
    tool: {
      id: 'read',
      name: 'read',
      title: '读记录',
      execution: 'server',
      status: 'running',
    },
  }
  applyTimelineItem(message, tool)
  applyTimelineItem(message, {
    id: 'answer',
    sequence: 3,
    revision: 0,
    createdAt: 'now',
    kind: 'answer',
    text: '完成',
    status: 'completed',
  })
  applyTimelineItem(message, {
    ...tool,
    revision: 1,
    tool: { ...tool.tool, status: 'completed' },
  })
  applyTimelineItem(message, tool)
  assert.deepEqual(
    message.timeline!.map((x) => x.sequence),
    [1, 2, 3],
  )
  assert.equal(
    message.timeline![1]!.kind === 'tool' && message.timeline![1]!.tool.status,
    'completed',
  )
})
