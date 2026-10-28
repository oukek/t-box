import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

test('opening a local application in WeChat never starts OAuth or takes over the guest workspace', async () => {
  const dom = new JSDOM('', { url: 'https://tboxos.cn/#/applications/calendar' })
  Object.defineProperty(dom.window.navigator, 'userAgent', { value: 'MicroMessenger/8.0 Mobile', configurable: true })
  const globals = ['window', 'document', 'location', 'history', 'localStorage', 'sessionStorage', 'navigator', 'fetch'] as const
  const before = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of globals.filter((key) => key !== 'fetch')) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  let requests = 0
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => {
    requests++
    throw new Error('A local guest must not require a login request')
  } })
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'silent' })
  try {
    const { initializeWechatLogin, wechatLogin, inWechat } = await server.ssrLoadModule('/src/features/identity/wechatLogin.ts')
    assert.equal(inWechat, true)
    await initializeWechatLogin()
    assert.equal(wechatLogin.initializing, false)
    assert.equal(wechatLogin.active, false)
    assert.equal(wechatLogin.phase, 'idle')
    assert.equal(requests, 0)
    assert.equal(location.hash, '#/applications/calendar')
    assert.equal(sessionStorage.getItem('tbox.wechat.authorization.v1'), null)
  } finally {
    await server.close()
    dom.window.close()
    for (const key of globals) {
      const descriptor = before.get(key)
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, key)
      }
    }
  }
})
