import assert from 'node:assert/strict'
import { test } from 'node:test'

// Exercise background authorization through its real message handlers, with no live accounts.
test('extension authentication isolates credentials and binds callbacks to its authorization window', async () => {
  const local: Record<string, unknown> = {}
  const session: Record<string, unknown> = {}
  let external: (message: unknown, sender: unknown, reply: (result: { ok: boolean, data?: unknown }) => void) => boolean
  let trusted = false
  let redeemCount = 0
  let revoked = 0
  let wechatDisabled = false
  let handoffRedeems = 0
  const macUser = '11111111-1111-1111-1111-111111111111'
  const storage = (data: Record<string, unknown>) => ({
    async get(key: string) {
      return { [key]: data[key] }
    },
    async set(values: Record<string, unknown>) {
      Object.assign(data, values)
    },
    async remove(key: string) {
      delete data[key]
    },
  })
  const previousChrome = globalThis.chrome
  const previousFetch = globalThis.fetch
  Object.assign(globalThis, { chrome: {
    storage: { local: { ...storage(local), async setAccessLevel(value: { accessLevel: string }) {
      trusted = value.accessLevel === 'TRUSTED_CONTEXTS'
    } }, session: storage(session) },
    runtime: { id: 'a'.repeat(32), onMessageExternal: { addListener(listener: typeof external) {
      external = listener
    } } },
    windows: { async create() {
      return { id: 8, tabs: [{ id: 9 }] }
    }, async remove() {}, onRemoved: { addListener() {} } },
    tabs: { async query() {
      return []
    } },
  } })
  let uploads = 0
  let failUpload = true
  globalThis.fetch = async (url, options) => {
    const path = String(url)
    if (path.endsWith('/collector/products')) {
      uploads++
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer fixture-extension-token')
      if (uploads === 2 && failUpload) {
        return Response.json({ error: { message: '保存失败' } }, { status: 503 })
      }
      return Response.json({ data: { ids: ['saved'], count: 1 } })
    }
    if (path.endsWith('/collector/start') && wechatDisabled) {
      return Response.json({ error: { message: 'disabled' } }, { status: 503 })
    }
    if (path.endsWith('/handoff/start')) {
      return Response.json({ data: { id: '22222222-2222-2222-2222-222222222222' } })
    }
    if (path.endsWith('/handoff/redeem')) {
      handoffRedeems++
      const body = JSON.parse(String(options?.body))
      assert.equal(body.target, 'collector')
      assert.equal(body.userId, macUser)
      return Response.json({ data: { token: 'mac-derived-token', user: { id: macUser, nickname: 'Mac 账号' } } })
    }
    if (path.endsWith('/collector/start')) {
      return Response.json({ data: { id: 'b'.repeat(36), qrUrl: 'https://tboxos.cn/?wechatScan=fixture', expiresAt: new Date(Date.now() + 60_000).toISOString() } })
    }
    if (path.endsWith('/collector/redeem')) {
      redeemCount++
      return Response.json({ data: { token: 'fixture-extension-token', user: { id: 'user', nickname: '测试账号' } } })
    }
    if (path.endsWith('/auth/me')) {
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer fixture-extension-token')
      return Response.json({ data: { id: 'user', nickname: '测试账号' } })
    }
    if (path.endsWith('/auth/session')) {
      revoked++
    }
    return new Response(null, { status: 204 })
  }
  try {
    const { authAction } = await import('../src/extension/auth')
    assert.equal(trusted, true)
    await authAction('account-login', { mode: 'other' })
    const attempt = session['collector.authorization.v1'] as { nonce: string }
    const sender = { tab: { id: 9 }, frameId: 0, url: 'https://tboxos.cn/' }
    const send = (action: string, override: object = {}, nonce = attempt.nonce) => new Promise<{ ok: boolean, data?: unknown }>((resolve) => external({ action, nonce }, { ...sender, ...override }, resolve))
    assert.equal((await send('collector-connect', { url: 'https://www.dianxiaomi.com/' })).ok, false)
    assert.equal((await send('collector-connect', { tab: { id: 10 } })).ok, false)
    assert.equal((await send('collector-connect', { frameId: 1 })).ok, false)
    assert.equal((await send('collector-connect', {}, 'wrong')).ok, false)
    assert.equal((await send('collector-connect')).ok, true)
    assert.equal((await send('collector-complete')).ok, true)
    assert.equal((await send('collector-complete')).ok, false)
    assert.equal(redeemCount, 1)
    assert.deepEqual(await authAction('account', {}), { id: 'user', nickname: '测试账号' })
    assert.equal(JSON.stringify(await authAction('account', {})).includes('token'), false)
    await authAction('account-logout', {})
    assert.equal(await authAction('account', {}), null)
    assert.equal(revoked, 1)
    assert.equal(local['collector.account.v1'], undefined)
    wechatDisabled = true
    await authAction('account-login', { mode: 'quick' })
    const next = session['collector.authorization.v1'] as { nonce: string }
    const nativeSend = (action: string, source = sender) => new Promise<{ ok: boolean, data?: unknown }>((resolve) => external({ action, nonce: next.nonce, userId: macUser }, source, resolve))
    assert.equal((await nativeSend('collector-connect')).ok, true, 'Mac login must work even when QR configuration is unavailable')
    assert.equal((await nativeSend('collector-desktop-complete')).ok, false)
    assert.equal((await nativeSend('collector-desktop-start', { ...sender, tab: { id: 10 } })).ok, false)
    assert.equal((await nativeSend('collector-desktop-start')).ok, true)
    assert.equal((await nativeSend('collector-complete')).ok, false, 'Old QR cannot replace a Mac handoff')
    assert.equal((await nativeSend('collector-desktop-complete')).ok, true)
    assert.equal((await nativeSend('collector-desktop-complete')).ok, false)
    assert.equal(handoffRedeems, 1)
    assert.equal((local['collector.account.v1'] as unknown as { token: string }).token, 'mac-derived-token')
    wechatDisabled = false
    await authAction('account-login', { mode: 'quick' })
    const retry = session['collector.authorization.v1'] as { nonce: string }
    const retrySend = (action: string) => new Promise<{ ok: boolean, data?: unknown }>((resolve) => external({ action, nonce: retry.nonce, userId: macUser }, sender, resolve))
    assert.equal((await retrySend('collector-desktop-start')).ok, true)
    assert.equal((await retrySend('collector-qr-start')).ok, true, 'Switching away from Mac creates a fresh QR proof')
    assert.equal((await retrySend('collector-desktop-complete')).ok, false, 'Stale Mac handoff cannot replace the selected QR login')
    assert.equal((await retrySend('collector-complete')).ok, true)
    await assert.rejects(authAction('account-collect', { userId: 'wrong', products: [{ id: 'a' }] }))
    assert.equal(uploads, 0)
    const partial = await authAction('account-collect', { userId: 'user', products: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
    assert.deepEqual(partial, { confirmed: [0], error: '保存失败' })
    failUpload = false
    assert.deepEqual(await authAction('account-collect', { userId: 'user', products: [{ id: 'b' }, { id: 'c' }] }), { confirmed: [0, 1], error: '' })
  } finally {
    globalThis.fetch = previousFetch
    globalThis.chrome = previousChrome
  }
})
