import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

test('Mac quick login uses loopback approval and a separate cloud redemption; failures never redeem', async () => {
  const dom = new JSDOM('', { url: 'https://tboxos.cn/' })
  const globals = ['window', 'document', 'location', 'history', 'localStorage', 'sessionStorage', 'navigator', 'fetch'] as const
  const before = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of globals.filter((key) => key !== 'fetch')) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  const user = { id: '11111111-1111-1111-1111-111111111111', nickname: 'Mac 用户' }
  const challenge = '22222222-2222-2222-2222-222222222222'
  const flowId = '33333333-3333-3333-3333-333333333333'
  let blocked = false
  let deny = false
  let approved = false
  let redeemed = 0
  let secret = ''
  localStorage.setItem('tbox.identity.wechat.v1', 'existing-browser-token')
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string, options: RequestInit) => {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const path = String(url)
    const body = options.body ? JSON.parse(String(options.body)) : null
    if (path.startsWith('http://127.0.0.1:17436/')) {
      if (blocked) {
        throw new TypeError('Permission denied')
      }
      assert.equal(options.credentials, 'omit')
      assert.equal((options as RequestInit & { targetAddressSpace: string }).targetAddressSpace, 'loopback')
      assert.equal((options.headers as Record<string, string>).Authorization, undefined)
      assert.equal((options.headers as Record<string, string>)['X-Tbox-Login'], '1')
      if (path.endsWith('/account')) {
        return Response.json({ user, challenge })
      }
      assert.equal(body.id, flowId)
      assert.equal(body.secret, secret)
      assert.equal(body.userId, user.id)
      assert.equal(body.challenge, challenge)
      if (deny) {
        return Response.json({ error: 'Mac 版账号已变化，请重新识别' }, { status: 409 })
      }
      approved = true
      return Response.json({ approved: true })
    }
    if (path.endsWith('/handoff/start')) {
      assert.equal(body.target, 'browser')
      assert.match(body.secret, /^[a-f0-9]{64}$/)
      secret = body.secret
      return Response.json({ data: { id: flowId } })
    }
    assert.equal(path.endsWith('/handoff/redeem'), true)
    assert.equal(approved, true)
    assert.equal(body.userId, user.id)
    assert.equal(body.target, 'browser')
    assert.equal(body.secret, secret)
    redeemed++
    return Response.json({ data: { token: 'new-browser-token', user } })
  } })
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'silent' })
  try {
    const module = await server.ssrLoadModule('/src/features/identity/desktopLogin.ts')
    assert.equal(await module.desktopPermission(), 'unknown')
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async (input: { name: string }) => {
      assert.equal(input.name, 'loopback-network')
      return { state: 'granted' }
    } } })
    assert.equal(await module.desktopPermission(), 'granted')
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'denied' }) } })
    assert.equal(await module.desktopPermission(), 'denied')
    const account = await module.detectDesktopAccount()
    assert.equal(account.user.id, user.id)
    const result = await module.loginFromDesktop(account)
    assert.equal(result.token, 'new-browser-token')
    assert.equal(localStorage.getItem('tbox.identity.wechat.v1'), 'existing-browser-token', 'The caller controls when to accept its own session')
    deny = true
    await assert.rejects(module.loginFromDesktop(account), /账号已变化/)
    assert.equal(redeemed, 1)
    blocked = true
    await assert.rejects(module.detectDesktopAccount(), /允许浏览器访问本机/)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(module.loginFromDesktop(account, controller.signal))
    assert.equal(redeemed, 1)
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
