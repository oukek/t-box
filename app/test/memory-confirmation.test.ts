import assert from 'node:assert/strict'
import test from 'node:test'
import {
  closeMemoryConfirmation,
  confirmMemory,
  memoryConfirmation,
} from '../src/features/chat/memoryConfirmation.js'

test('memory confirmation cannot carry approval to a replacement request or survive cancellation', async () => {
  const first = confirmMemory({
    action: 'remember',
    label: '偏好',
    content: '简洁',
  })
  assert.equal(memoryConfirmation.proposal?.content, '简洁')
  const second = confirmMemory({ action: 'forget', label: '主题' })
  assert.deepEqual(await first, { approved: false })
  closeMemoryConfirmation(true)
  assert.deepEqual(await second, { approved: true })
  assert.equal(memoryConfirmation.proposal, null)
  closeMemoryConfirmation(true)
  const third = confirmMemory({
    action: 'remember',
    label: '语言',
    content: '中文',
  })
  closeMemoryConfirmation()
  assert.deepEqual(await third, { approved: false })
  assert.deepEqual(await confirmMemory({ action: 'execute', label: '无效' }), {
    approved: false,
  })
  assert.equal(memoryConfirmation.proposal, null)
})
