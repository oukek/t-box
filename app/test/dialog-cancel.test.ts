import assert from 'node:assert/strict'
import test from 'node:test'
import { handleDialogCancel } from '@t-box/ui-kit/dialogCancel'
import { JSDOM } from 'jsdom'

test('cancelling a file picker does not close the enclosing dialog or suppress input cancel', () => {
  const dom = new JSDOM('<dialog open><input type="file" multiple></dialog>')
  const dialog = dom.window.document.querySelector('dialog')!
  const input = dialog.querySelector('input')!
  let closed = 0
  dialog.addEventListener('cancel', (e) =>
    handleDialogCancel(e, dialog, false, () => closed++))
  // The native file picker emits cancel on dismissal or selecting the same files again.
  for (let i = 0; i < 2; i++) {
    const event = new dom.window.Event('cancel', {
      bubbles: true,
      cancelable: true,
    })
    input.dispatchEvent(event)
    assert.equal(event.defaultPrevented, false)
    assert.equal(closed, 0)
    assert.equal(dialog.open, true)
  }
  const escape = new dom.window.Event('cancel', { cancelable: true })
  dialog.dispatchEvent(escape)
  assert.equal(closed, 1)
  assert.equal(escape.defaultPrevented, true)
  dom.window.close()
})
test('busy dialogs suppress native Escape closing while preserving file-picker cancellation', () => {
  const dom = new JSDOM('<dialog open><input type="file"></dialog>')
  const dialog = dom.window.document.querySelector('dialog')!
  let closed = 0
  dialog.addEventListener('cancel', (e) =>
    handleDialogCancel(e, dialog, true, () => closed++))
  const event = new dom.window.Event('cancel', { cancelable: true })
  dialog.dispatchEvent(event)
  assert.equal(event.defaultPrevented, true)
  assert.equal(closed, 0)
  const inputEvent = new dom.window.Event('cancel', {
    bubbles: true,
    cancelable: true,
  })
  dialog.querySelector('input')!.dispatchEvent(inputEvent)
  assert.equal(inputEvent.defaultPrevented, false)
  dom.window.close()
})
