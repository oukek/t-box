import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lockPageZoom } from '../src/pageViewport.js'

test('page zoom is blocked while ordinary scrolling, typing and copy shortcuts still work', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const document = new EventTarget()
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: document,
  })
  const release = lockPageZoom()
  const dispatch = (name: string, properties: object) => {
    const event = Object.assign(
      new Event(name, { cancelable: true }),
      properties,
    )
    document.dispatchEvent(event)
    return event.defaultPrevented
  }
  try {
    assert.equal(dispatch('touchmove', { touches: [{}, {}] }), true)
    assert.equal(dispatch('gesturestart', {}), true)
    assert.equal(dispatch('wheel', { ctrlKey: true }), true)
    assert.equal(dispatch('keydown', { ctrlKey: true, key: '+' }), true)
    assert.equal(dispatch('keydown', { metaKey: true, key: '-' }), true)
    assert.equal(dispatch('touchmove', { touches: [{}] }), false)
    assert.equal(dispatch('wheel', { ctrlKey: false }), false)
    assert.equal(dispatch('keydown', { ctrlKey: true, key: 'c' }), false)
    assert.equal(dispatch('keydown', { key: '1' }), false)
    release()
    assert.equal(dispatch('gesturestart', {}), false)
    assert.equal(dispatch('wheel', { ctrlKey: true }), false)
  } finally {
    release()
    if (previous) {
      Object.defineProperty(globalThis, 'document', previous)
    } else {
      Reflect.deleteProperty(globalThis, 'document')
    }
  }
})
