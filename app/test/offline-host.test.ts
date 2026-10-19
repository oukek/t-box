import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

test('real host transport boots locally without HTTP, blocks backend work offline and revalidates after reconnect', async () => {
  const dom = new JSDOM('', { url: 'https://host.test/' })
  const globals = ['window', 'document', 'location', 'localStorage', 'navigator', 'fetch'] as const
  const before = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  let online = false
  let requests = 0
  Object.defineProperty(dom.window.navigator, 'onLine', { configurable: true, get: () => online })
  for (const key of globals.filter((key) => key !== 'fetch')) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'silent' })
  try {
    const { createHostTransport } = await server.ssrLoadModule('/src/core/app-runtime/sdkHost.ts')
    const { appCatalog } = await server.ssrLoadModule('/src/core/app-runtime/catalog.ts')
    const { setSession, identity, restoreLocalIdentity, restoreError } = await server.ssrLoadModule('/src/core/session.ts')
    const { request } = await server.ssrLoadModule('/src/core/network.ts')
    const { restoreSession } = await server.ssrLoadModule('/src/features/identity/identityApi.ts')
    const subject = 'b'.repeat(64)
    const release = { appId: 'notes', releaseId: 'notes-1', protocol: 1, kind: 'user', platforms: ['web'], defaultInstalled: false, permissions: ['storage', 'api.request'], clientTools: [], backend: { type: 'local', binding: 'notes' }, runtime: { type: 'web', entryUrl: `https://apps.test/notes/${'a'.repeat(64)}/`, integrity: `sha256-${'a'.repeat(64)}` }, manifest: { id: 'notes', name: '笔记', description: '', version: '1.0.0', icon: 'apps', color: 'blue', skillIds: [] } }
    setSession({ token: 'test-session', user: { id: 'alice', username: 'alice', nickname: 'Alice', createdAt: '2026-01-01' } })
    appCatalog.entries = [{ release, installedRelease: release, localBinding: { subject, storage: true }, installation: { appId: 'notes', releaseId: 'notes-1', generation: 1, status: 'active', grants: ['storage'], targetReleaseId: null, operationId: null } }]
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (path: string) => {
      requests++
      if (path.includes('/context')) {
        return new Response(JSON.stringify({ data: { sdkVersion: 1, appId: 'notes', releaseId: 'notes-1', generation: 1, subject, platform: 'web', runtime: 'web', params: {}, permissions: [], capabilities: ['api.invoke'] } }))
      }
      if (path.endsWith('/invoke')) {
        return new Response(JSON.stringify({ data: { saved: true } }))
      }
      return new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: '登录失效' } }), { status: 401 })
    } })
    const transport = createHostTransport({ appId: 'notes', expected: { releaseId: 'notes-1', generation: 1, subject } })
    try {
      assert.equal((await transport.call('runtime.context', {})).access, 'local')
      await transport.call('storage.set', { key: 'history', value: ['1+1=2'] })
      assert.deepEqual(await transport.call('storage.get', { key: 'history' }), ['1+1=2'])
      await restoreSession()
      assert.equal(identity.ready, true)
      assert.equal(identity.verification, 'local')
      for (const method of ['api.invoke', 'api.request', 'files.pick', 'resources.bindings', 'device.reminders', 'events.subscribe']) {
        await assert.rejects(transport.call(method, {}), { code: 'NETWORK_REQUIRED' })
      }
      await assert.rejects(request('/calendar/events', { method: 'POST', body: '{}' }), { code: 'NETWORK_REQUIRED' })
      assert.equal(requests, 0)
      online = true
      assert.deepEqual(await transport.call('api.invoke', { method: 'create', arguments: {} }), { saved: true })
      assert.equal(requests, 2, 'reconnection must verify the actual installation before the backend operation')
      await restoreSession()
      assert.equal(identity.user, null, '401 revokes the locally restored shell account')
      assert.equal(restoreLocalIdentity(), false, 'revoked snapshots cannot silently restore the account')
      await assert.rejects(transport.call('storage.get', { key: 'history' }))
    } finally {
      transport.close()
    }
    const { localApplications, localEntries, localBaselineLaunch, loadLocalApplications } = await server.ssrLoadModule('/src/core/app-runtime/localApplications.ts')
    localApplications.releases = [{ ...release, releaseId: 'notes-bundled-1', kind: 'system', defaultInstalled: true, platforms: ['web', 'ios', 'android'], runtime: { ...release.runtime, entryUrl: `https://bundled.tbox.invalid/notes/${'a'.repeat(64)}/` } }]
    appCatalog.entries = localEntries()
    online = false
    const beforeGuest = requests
    const guestRuntime = localBaselineLaunch('notes', 'web').descriptor
    const guest = createHostTransport({ appId: 'notes', expected: guestRuntime })
    try {
      assert.equal(identity.user, null)
      assert.equal((await guest.call('runtime.context', {})).access, 'local')
      await guest.call('storage.set', { key: 'history', value: ['guest calculation'] })
      assert.deepEqual(await guest.call('storage.get', { key: 'history' }), ['guest calculation'])
      assert.equal((await guest.call('auth.session', {})).status, 'signed_out')
      await assert.rejects(guest.call('api.invoke', { method: 'create' }), { code: 'AUTH_REQUIRED' })
      assert.equal(requests, beforeGuest, 'a fresh guest utility needs neither auth nor backend context')
      setSession({ token: 'second-session', user: { id: 'bob', username: 'bob', nickname: 'Bob', createdAt: '2026-01-01' } })
      appCatalog.entries = localEntries('bob')
      const signed = createHostTransport({ appId: 'notes', expected: localBaselineLaunch('notes', 'web', 'bob').descriptor })
      try {
        assert.equal(await signed.call('storage.get', { key: 'history' }), null, 'guest data cannot silently enter a signed-in account')
        online = true
        await assert.rejects(signed.call('api.invoke', { method: 'create' }), { code: 'APP_UPDATE_REQUIRED' })
        assert.equal(requests, beforeGuest)
      } finally {
        signed.close()
      }
    } finally {
      guest.close()
      localApplications.releases = []
    }
    setSession(null)
    online = false
    const beforeWebGuest = requests
    await loadLocalApplications()
    assert.deepEqual(localApplications.releases.map((entry: { appId: string }) => entry.appId).sort(), ['calculator', 'calendar', 'converter', 'time'])
    const { descriptor } = await server.ssrLoadModule('/src/core/app-runtime/bridge.ts')
    const webRuntime = await descriptor('calculator')
    assert.equal(webRuntime.localOnly, true, 'web guests must not call the Capacitor resource plugin')
    assert.equal(requests, beforeWebGuest)
    restoreError('账号验证需要联网')
    const pendingAccount = createHostTransport({ appId: 'calculator', expected: webRuntime })
    try {
      assert.equal(identity.ready, false)
      assert.equal((await pendingAccount.call('runtime.context', {})).access, 'local', 'account recovery must not block guest local tools')
      await assert.rejects(pendingAccount.call('api.invoke', { method: 'create' }), { code: 'AUTH_REQUIRED' })
      assert.equal(requests, beforeWebGuest)
    } finally {
      pendingAccount.close()
    }
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
