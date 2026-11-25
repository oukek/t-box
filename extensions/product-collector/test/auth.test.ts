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
  globalThis.fetch = async (url, options) => {
    const path = String(url)
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
  } finally {
    globalThis.fetch = previousFetch
    globalThis.chrome = previousChrome
  }
})
