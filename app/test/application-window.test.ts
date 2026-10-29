import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { applicationPhone, applicationWindowSize, constrainApplicationWindow, initialApplicationWindow } from '../src/core/app-runtime/windowGeometry'

test('phone windows retain their aspect ratio and stay reachable after dragging, rotation and keyboard resize', () => {
  for (const viewport of [
    { width: 1440, height: 900, left: 0, top: 0 },
    { width: 390, height: 844, left: 0, top: 0 },
    { width: 320, height: 568, left: 0, top: 0 },
    { width: 844, height: 390, left: 0, top: 0 },
    { width: 390, height: 280, left: 0, top: 120 },
  ]) {
    for (const expanded of [false, true]) {
      const size = applicationWindowSize(viewport, expanded)
      assert.ok(size.width > 0 && size.width <= viewport.width)
      assert.ok(size.height <= viewport.height)
      assert.ok(Math.abs((size.height - applicationPhone.toolbar) / size.width - applicationPhone.height / applicationPhone.width) < 1e-9)
      for (const desired of [initialApplicationWindow(size, viewport), { x: -10000, y: -10000 }, { x: 10000, y: 10000 }]) {
        const point = constrainApplicationWindow(desired, size, viewport)
        assert.ok(point.x >= viewport.left && point.x + size.width <= viewport.left + viewport.width + 0.001)
        assert.ok(point.y >= viewport.top && point.y + size.height <= viewport.top + viewport.height + 0.001)
      }
    }
  }
})

test('the host opens current and future applications over chat without navigating, scrolling or losing the draft', async () => {
  const dom = new JSDOM('<textarea id="draft">Keep this draft</textarea>', { url: 'http://localhost/#/' })
  const globals = ['window', 'document', 'location', 'history', 'localStorage', 'sessionStorage', 'navigator', 'HTMLElement', 'fetch'] as const
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of globals.filter((key) => key !== 'fetch')) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  let scrolls = 0
  dom.window.scrollTo = () => {
    scrolls++
  }
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => {
    throw new Error('Navigation must not require cloud access')
  } })
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'silent' })
  try {
    const navigation = await server.ssrLoadModule('/src/core/navigation.ts')
    const { applicationModules } = await server.ssrLoadModule('/src/applications/registry.ts')
    // A future app uses exactly the same presentation contract as a bundled app.
    applicationModules.push({ ...applicationModules[0], manifest: { ...applicationModules[0].manifest, id: 'future-window-app' }, prepare: async () => {}, parseParams: (value: unknown) => value })
    navigation.startNavigation()
    const draft = dom.window.document.querySelector('textarea')!
    draft.focus()
    const originalHistory = history.length
    await navigation.openApplication({ appId: 'future-window-app', params: { record: 'selected' } })
    assert.equal(navigation.navigation.screen, 'home')
    assert.equal(navigation.navigation.applicationPresentation, 'window')
    assert.equal(navigation.navigation.application.params.record, 'selected')
    assert.equal(navigation.isApplicationActive('future-window-app'), true)
    assert.equal(navigation.isApplicationActive('calendar'), false)
    assert.equal(location.hash, '#/')
    assert.equal(history.length, originalHistory)
    assert.equal(scrolls, 0)
    assert.equal(document.activeElement, draft)
    assert.equal(draft.value, 'Keep this draft')
    navigation.backFromApplication()
    assert.equal(navigation.navigation.screen, 'home')
    assert.equal(navigation.navigation.application, null)
    assert.equal(navigation.isApplicationActive('future-window-app'), false)
    navigation.navigateTab('applications')
    await navigation.openApplication({ appId: 'future-window-app' })
    assert.equal(navigation.navigation.screen, 'application')
    assert.equal(navigation.navigation.applicationPresentation, 'page')
    assert.equal(location.hash, '#/applications/future-window-app')
    navigation.backFromApplication()
    assert.equal(navigation.navigation.screen, 'applications')
    navigation.navigateTab('home')
    await navigation.openApplication({ appId: 'future-window-app' })
    navigation.openResources()
    assert.equal(navigation.navigation.applicationPresentation, 'page')
    navigation.navigateTab('home')
    assert.equal(navigation.navigation.application, null, 'Leaving chat cannot resurrect a disposed application window later')
  } finally {
    await server.close()
    dom.window.close()
    for (const key of globals) {
      const descriptor = previous.get(key)
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, key)
      }
    }
  }
})
