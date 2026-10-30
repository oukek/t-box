import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { canFloatAssistant, constrainAssistant, dockLauncher, initialAssistant, launcherPoint, readAssistantLayout } from '../src/features/assistant/geometry'

test('assistant adapts to available space and keeps dragged windows and docked controls reachable', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 260 }]) {
    assert.equal(canFloatAssistant(viewport), viewport.width >= 900 && viewport.height >= 540)
    for (const rect of [initialAssistant(viewport), { x: -10000, y: -10000, width: 20, height: 20 }, { x: 10000, y: 10000, width: 4000, height: 4000 }]) {
      const actual = constrainAssistant(rect, viewport)
      assert.ok(actual.x >= 12 && actual.y >= 12)
      assert.ok(actual.x + actual.width <= viewport.width - 12)
      assert.ok(actual.y + actual.height <= viewport.height - 12)
    }
    for (const point of [{ x: -10000, y: -10000 }, { x: 10000, y: 10000 }]) {
      const dock = dockLauncher(point, viewport)
      const actual = launcherPoint(dock, viewport)
      assert.ok(actual.x >= 8 && actual.x + 56 <= viewport.width - 8)
      assert.ok(actual.y >= 64 && actual.y + 56 <= viewport.height - 32)
      assert.deepEqual(dockLauncher(actual, viewport), dock)
    }
  }
  assert.deepEqual(readAssistantLayout('bad json'), {})
  assert.deepEqual(readAssistantLayout('null'), {})
  assert.equal(readAssistantLayout('{"rect":{"width":"wide"}}').rect, undefined)
  assert.equal(readAssistantLayout('{"dock":{"side":"right","ratio":8}}').dock?.ratio, 1)
})

test('desktop is the default; assistant history preserves the active app and applications open in the workspace', async () => {
  const dom = new JSDOM('<textarea id="draft">Keep this draft</textarea>', { url: 'http://localhost/#/' })
  const globals = ['window', 'document', 'location', 'history', 'localStorage', 'sessionStorage', 'navigator', 'HTMLElement', 'fetch'] as const
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of globals.filter((key) => key !== 'fetch')) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  dom.window.scrollTo = () => {}
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => {
    throw new Error('Navigation must not require cloud access')
  } })
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'silent' })
  const hashChanged = () => new Promise<void>((resolve) => dom.window.addEventListener('hashchange', () => resolve(), { once: true }))
  try {
    const nav = await server.ssrLoadModule('/src/core/navigation.ts')
    const { applicationModules } = await server.ssrLoadModule('/src/applications/registry.ts')
    applicationModules.push({ ...applicationModules[0], manifest: { ...applicationModules[0].manifest, id: 'future-assistant-app' }, prepare: async () => {}, parseParams: (value: unknown) => value })
    nav.startNavigation()
    assert.equal(nav.navigation.screen, 'applications')
    assert.equal(nav.navigation.assistantOpen, false)
    await nav.openApplication({ appId: 'future-assistant-app', params: { record: 'selected' } })
    const application = nav.navigation.application
    const revision = nav.navigation.revision
    nav.openAssistant()
    assert.equal(nav.navigation.screen, 'application')
    assert.equal(nav.navigation.assistantOpen, true)
    assert.match(location.hash, /__assistant=1/)
    let changed = hashChanged()
    nav.closeAssistant()
    await changed
    assert.equal(nav.navigation.assistantOpen, false)
    assert.equal(nav.navigation.application, application, 'closing the assistant does not restart an app')
    assert.equal(nav.navigation.revision, revision)
    changed = hashChanged()
    history.forward()
    await changed
    assert.equal(nav.navigation.assistantOpen, true)
    assert.equal(nav.navigation.application, application)
    await nav.openApplication({ appId: 'future-assistant-app', params: { record: 'another' } })
    assert.equal(nav.navigation.screen, 'application')
    assert.equal(nav.navigation.assistantOpen, true, 'wide screens keep AI alongside the app')
    assert.equal(nav.isApplicationActive('future-assistant-app'), true)
    nav.openResources()
    assert.equal(nav.navigation.assistantOpen, false)
    nav.backFromApplication()
    assert.equal(nav.navigation.screen, 'application')
    assert.equal(nav.navigation.assistantOpen, true)
    assert.equal(nav.navigation.application.params.record, 'another')
    Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 390 })
    await nav.openApplication({ appId: 'future-assistant-app' })
    assert.equal(nav.navigation.assistantOpen, false, 'phones show the opened app as a full page')
    assert.equal(location.hash, '#/applications/future-assistant-app')
    nav.navigateTab('home')
    assert.equal(nav.navigation.assistantOpen, true)
    assert.equal(nav.navigation.screen, 'application')
    nav.navigateTab('applications')
    assert.equal(nav.navigation.screen, 'applications')
    assert.equal(nav.navigation.assistantOpen, false)
    assert.equal(location.hash, '#/')
    const entries = history.length
    nav.navigateTab('applications')
    assert.equal(history.length, entries, 'clicking the desktop brand twice must not add duplicate history')
    for (const hash of ['#/ai', '#/applications', '#/']) {
      history.replaceState(null, '', hash)
      window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'))
      assert.equal(nav.navigation.screen, 'applications')
      assert.equal(nav.navigation.assistantOpen, hash === '#/ai')
    }
    assert.equal(dom.window.document.querySelector('textarea')!.value, 'Keep this draft')
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
