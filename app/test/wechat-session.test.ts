import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

test('password-era browser credentials cannot restore the WeChat login store; new WeChat sessions persist', async () => {
  const dom = new JSDOM('', { url: 'https://tboxos.cn/' })
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'silent' })
  try {
    const user = { id: 'fixture', username: 'old_user', nickname: '旧账号', createdAt: '2026-10-28' }
    localStorage.setItem('tbox.identity.v1', 'old-password-token')
    localStorage.setItem('tbox.identity.local-profile.v1', JSON.stringify(user))
    const session = await server.ssrLoadModule('/src/core/session.ts')
    assert.equal(session.identity.token, '')
    assert.equal(session.identity.user, null)
    assert.equal(localStorage.getItem('tbox.identity.v1'), null)
    assert.equal(localStorage.getItem('tbox.identity.local-profile.v1'), null)
    session.setSession({ token: 'verified-wechat-token', user: { ...user, username: 'wx_fixture', nickname: '方舟' } })
    assert.equal(localStorage.getItem('tbox.identity.wechat.v1'), 'verified-wechat-token')
    localStorage.setItem('tbox.identity.v1', 'stale-password-token')
    const reloaded = await server.ssrLoadModule('/src/core/session.ts?wechat-resume')
    assert.equal(reloaded.identity.token, 'verified-wechat-token')
    assert.equal(localStorage.getItem('tbox.identity.v1'), null)
    assert.ok(localStorage.getItem('tbox.identity.local-profile.v1'), 'A real WeChat session keeps its offline profile')
  } finally {
    await server.close()
    dom.window.close()
    if (before) {
      Object.defineProperty(globalThis, 'localStorage', before)
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage')
    }
  }
})
