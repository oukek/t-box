import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { effectScope, ref } from 'vue'
import { useAppDrag } from '../src/features/applications/useAppDrag'

function fixture(t: TestContext) {
  const dom = new JSDOM('<div class="desktop-grid"><article data-app-id="a"><button>A</button></article><article data-app-id="b"><button>B</button></article></div>')
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
  const grid = document.querySelector<HTMLElement>('.desktop-grid')!
  const button = grid.querySelector('button')!
  const captures = new Set<number>()
  grid.setPointerCapture = (id) => {
    captures.add(id)
  }
  grid.hasPointerCapture = (id) => captures.has(id)
  grid.releasePointerCapture = (id) => {
    captures.delete(id)
  }
  document.elementFromPoint = () => document.querySelector('[data-app-id="b"]')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const order = ref(['a', 'b'])
  const editing = ref(false)
  const commits: string[][] = []
  const scope = effectScope()
  const sort = scope.run(() => useAppDrag(order, editing, () => true, (ids) => commits.push(ids)))!
  const pointer = (x = 10, y = 10) => ({ button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y, currentTarget: button }) as unknown as PointerEvent
  t.after(() => {
    scope.stop()
    dom.window.close()
    if (previous) {
      Object.defineProperty(globalThis, 'document', previous)
    } else {
      Reflect.deleteProperty(globalThis, 'document')
    }
  })
  return { sort, order, editing, commits, captures, pointer, time: (value: number) => {
    now = value
  } }
}

test('a short tap launches normally; movement before a long press keeps scrolling available', (t) => {
  const f = fixture(t)
  f.sort.start(f.pointer(), 'a')
  t.mock.timers.tick(100)
  f.sort.end(f.pointer())
  assert.equal(f.editing.value, false)
  assert.equal(f.sort.consumeClick(), false)
  f.sort.start(f.pointer(), 'a')
  f.sort.move(f.pointer(10, 30))
  t.mock.timers.tick(500)
  assert.equal(f.editing.value, false)
  assert.equal(f.sort.drag.appId, '')
  assert.deepEqual(f.commits, [])
})
test('holding for several seconds still suppresses the release click without opening app details', (t) => {
  const f = fixture(t)
  f.sort.start(f.pointer(), 'a')
  t.mock.timers.tick(450)
  f.time(5000)
  assert.equal(f.editing.value, true)
  assert.equal(f.sort.consumeClick(), true)
  assert.ok(f.captures.has(1))
  f.sort.end(f.pointer())
  assert.equal(f.sort.consumeClick(), true)
  f.time(5600)
  assert.equal(f.sort.consumeClick(), false)
  assert.deepEqual(f.commits, [])
})
test('the same held pointer can drag, then commit exactly once on release', (t) => {
  const f = fixture(t)
  let prevented = false
  const touch = { cancelable: true, preventDefault: () => {
    prevented = true
  } } as TouchEvent
  f.sort.start(f.pointer(), 'a')
  f.sort.touchMove(touch)
  assert.equal(prevented, false)
  t.mock.timers.tick(450)
  f.sort.touchMove(touch)
  assert.equal(prevented, true)
  f.sort.move(f.pointer(80))
  assert.deepEqual(f.order.value, ['b', 'a'])
  assert.equal(f.sort.drag.appId, 'a')
  f.sort.end(f.pointer(80))
  f.sort.end(f.pointer(80))
  assert.deepEqual(f.commits, [['b', 'a']])
  assert.equal(f.sort.drag.appId, '')
  assert.equal(f.sort.consumeClick(), true)
})
test('canceling a drag restores the original order and never saves an intermediate layout', (t) => {
  const f = fixture(t)
  f.sort.start(f.pointer(), 'a')
  t.mock.timers.tick(450)
  f.sort.move(f.pointer(80))
  f.sort.cancel()
  assert.deepEqual(f.order.value, ['a', 'b'])
  assert.deepEqual(f.commits, [])
  assert.equal(f.sort.consumeClick(), true)
  assert.equal(f.captures.size, 0)
})
