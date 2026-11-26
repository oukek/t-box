import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

test('installed PWA stores an independent token and Mac is not confused with a Mac browser', async () => {
  const dom = new JSDOM('', { url: 'https://tboxos.cn/' })
  const keys = ['window', 'document', 'navigator', 'localStorage'] as const
  const before = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of keys) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  let installed = false
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: installed }) })
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { clientKind } = await server.ssrLoadModule('/src/core/clientKind.ts')
    assert.equal(clientKind(), 'web')
    installed = true
    assert.equal(clientKind(), 'pwa')
    localStorage.setItem('tbox.identity.wechat.v1', 'browser-token')
    const pwa = await server.ssrLoadModule('/src/core/session.ts')
    assert.equal(pwa.identity.token, '')
    pwa.setSession({ token: 'pwa-token', user: { id: 'pwa', nickname: 'PWA' } })
    assert.equal(localStorage.getItem('tbox.identity.wechat.v1'), 'browser-token')
    assert.equal(localStorage.getItem('tbox.identity.pwa.v1'), 'pwa-token')
    pwa.setSession(null)
    assert.equal(localStorage.getItem('tbox.identity.wechat.v1'), 'browser-token')
    window.__TBOX_DESKTOP_KEY__ = 'fixture'
    assert.equal(clientKind(), 'mac')
  } finally {
    await server.close()
    dom.window.close()
    for (const [key, descriptor] of before) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, key)
      }
    }
  }
})
