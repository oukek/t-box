import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

test('dialog lifecycle handles initially open async views, delayed refs, reopening and nested scroll locks', async () => {
  const dom = new JSDOM('<body style="overflow:auto"><button id="trigger">更新</button><main></main></body>')
  const keys = ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node'] as const
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of keys) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  const closeEvents: HTMLDialogElement[] = []
  let openings = 0
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    assert.equal(this.isConnected, true, 'native modal must not open before its element mounts')
    assert.equal(this.open, false)
    openings++
    this.open = true
  }
  dom.window.HTMLDialogElement.prototype.close = function () {
    if (this.open) {
      this.open = false
      closeEvents.push(this)
    }
  }
  const flushCloses = () => {
    for (const dialog of closeEvents.splice(0)) {
      dialog.dispatchEvent(new dom.window.Event('close'))
    }
  }
  const { createApp, defineAsyncComponent, defineComponent, h, nextTick, ref } = await import('vue')
  const { useDialog } = await import('@t-box/ui-kit/useDialog')
  const open = ref(true)
  const attached = ref(false)
  const nested = ref(false)
  let opened = 0
  let restored = 0
  const Content = defineComponent({
    setup() {
      const first = useDialog(() => open.value, { opened: () => opened++, closed: () => restored++ })
      const second = useDialog(() => nested.value)
      return () => h('section', [
        attached.value ? h('dialog', { 'ref': first.dialog, 'aria-label': '应用详情', 'onClose': first.closed }, '同意权限并更新') : null,
        h('dialog', { ref: second.dialog, onClose: second.closed }, '二级弹窗'),
      ])
    },
  })
  let resolveComponent: ((component: typeof Content) => void) | undefined
  const AsyncContent = defineAsyncComponent(() => new Promise<typeof Content>((resolve) => {
    resolveComponent = resolve
  }))
  const app = createApp({ render: () => h(AsyncContent) })
  try {
    const trigger = dom.window.document.querySelector<HTMLButtonElement>('#trigger')!
    trigger.focus()
    app.mount(dom.window.document.querySelector('main')!)
    resolveComponent!(Content)
    // Resolve the async component first; its dialog ref arrives in a later render.
    for (let index = 0; index < 6; index++) {
      await Promise.resolve()
      await nextTick()
    }
    assert.equal(dom.window.document.querySelector('dialog[open]'), null)
    attached.value = true
    await nextTick()
    const first = dom.window.document.querySelector<HTMLDialogElement>('dialog[aria-label="应用详情"]')!
    assert.equal(first.open, true, 'initial true must open when the delayed template ref arrives')
    assert.equal(opened, 1)
    assert.equal(dom.window.document.body.style.overflow, 'hidden')
    attached.value = true
    await nextTick()
    assert.equal(openings, 1, 'repeat updates must not close or reopen an already open modal')
    open.value = false
    await nextTick()
    assert.equal(first.open, false)
    open.value = true
    await nextTick()
    flushCloses()
    assert.equal(first.open, true)
    assert.equal(restored, 0, 'a delayed close event cannot unlock the newly opened modal')
    assert.equal(dom.window.document.body.style.overflow, 'hidden')
    nested.value = true
    await nextTick()
    open.value = false
    await nextTick()
    flushCloses()
    assert.equal(dom.window.document.body.style.overflow, 'hidden', 'closing one dialog must preserve the nested lock')
    nested.value = false
    await nextTick()
    flushCloses()
    assert.equal(dom.window.document.body.style.overflow, 'auto')
    assert.equal(dom.window.document.activeElement, trigger)
    open.value = true
    await nextTick()
    app.unmount()
    flushCloses()
    assert.equal(dom.window.document.body.style.overflow, 'auto', 'unmount must release its own lock')
  } finally {
    if (dom.window.document.querySelector('main')?.childNodes.length) {
      app.unmount()
    }
    dom.window.close()
    for (const key of keys) {
      const descriptor = previous.get(key)
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, key)
      }
    }
  }
})
