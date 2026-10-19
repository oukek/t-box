import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import test from 'node:test'
import vm from 'node:vm'
import { createOfflineWorker } from './offline-worker.mjs'
import { createResourceInstaller } from './resource-installer.mjs'

const sha = (value) => createHash('sha256').update(value).digest('hex')
function fixture(corrupt = false) {
  const contents = { 'index.html': '<html>verified</html>', 'assets/main.js': 'console.log(1)', 'tbox-offline-sw.js': '/* worker */' }
  const files = Object.fromEntries(Object.entries(contents).map(([path, value]) => [path, sha(value)]))
  const digest = sha(JSON.stringify(files))
  const base = `https://apps.test/notes/${digest}/`
  const stores = new Map([['previous', new Map([['healthy', new Response('previous')]])]])
  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        stores.set(name, new Map())
      }
      const values = stores.get(name)
      return { async match(key) {
        return values.get(key)?.clone()
      }, async put(key, response) {
        values.set(key, response.clone())
      } }
    },
    async delete(name) {
      return stores.delete(name)
    },
    async keys() {
      return [...stores.keys()]
    },
  }
  let fetched = 0
  let offline = false
  const registration = { scope: base, active: { state: 'activated' }, async unregister() {
    return true
  } }
  async function run(remove = false) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('installer hung')), 1000)
      const messages = []
      const context = vm.createContext({
        location: { href: `${base}tbox-resource.html?host=https://host.test&nonce=fixture${remove ? '&remove=1' : ''}` },
        parent: { postMessage(value, origin) {
          assert.equal(origin, 'https://host.test')
          messages.push(value)
          if (['ready', 'failed', 'removed'].includes(value.status)) {
            clearTimeout(timer)
            resolve(messages)
          }
        } },
        isSecureContext: true,
        navigator: { get onLine() {
          return !offline
        }, serviceWorker: { async getRegistration() {
          return registration
        }, async register() {
          throw new Error('cached worker must not hit network')
        } } },
        caches,
        crypto: webcrypto,
        TextEncoder,
        Uint8Array,
        URL,
        Response,
        Headers,
        AbortSignal,
        setTimeout,
        clearTimeout,
        fetch: async (url, options) => {
          fetched++
          if (offline) {
            throw new Error('offline')
          }
          assert.equal(options.credentials, 'omit')
          assert.equal(options.redirect, 'error')
          const path = String(url).slice(base.length)
          return new Response(path === 'artifact.json' ? JSON.stringify({ protocol: 1, appId: 'notes', digest, files }) : corrupt && path.endsWith('.js') ? 'corrupted' : contents[path])
        },
      })
      vm.runInContext(createResourceInstaller(), context)
    })
  }
  return { run, stores, caches, base, digest, get fetched() {
    return fetched
  }, offline() {
    offline = true
  } }
}
test('web resource installer verifies a complete package, reports real progress, reuses it offline and explicitly repairs its own scope', async () => {
  const f = fixture()
  const messages = await f.run()
  assert.equal(messages.at(-1).status, 'ready')
  assert.equal(messages.filter((m) => m.status === 'progress').length, 3)
  const count = f.fetched
  f.offline()
  assert.equal((await f.run()).at(-1).status, 'ready')
  assert.equal(f.fetched, count, 'neither the manifest nor worker registration waits for the network on a cached launch')
  assert.equal((await f.run(true)).at(-1).status, 'removed')
  assert.ok(f.stores.has('previous'))
  assert.ok(!f.stores.has(`tbox-package-v1:${new URL(f.base).pathname}`))
})
test('a corrupt web download never publishes its completion marker or destroys the previous healthy version', async () => {
  const f = fixture(true)
  const messages = await f.run()
  assert.equal(messages.at(-1).status, 'failed')
  assert.match(messages.at(-1).message, /校验/)
  assert.ok(f.stores.has('previous'))
  assert.ok(!f.stores.has(`tbox-package-v1:${new URL(f.base).pathname}`))
})
test('a missing package offline fails immediately with an actionable message and never attempts download', async () => {
  const f = fixture()
  f.offline()
  const messages = await f.run()
  assert.equal(messages.at(-1).status, 'failed')
  assert.match(messages.at(-1).message, /联网/)
  assert.equal(f.fetched, 0)
})
test('a hanging host navigation falls back to its cached shell within a bounded network attempt', async () => {
  const events = new Map()
  let deadline = 0
  const context = vm.createContext({
    registration: { scope: 'https://host.test/' },
    URL,
    Response,
    AbortController,
    addEventListener: (name, fn) => events.set(name, fn),
    setTimeout: (fn, ms) => {
      deadline = ms
      return setTimeout(fn, 5)
    },
    clearTimeout,
    caches: { async open() {
      return { async match() {
        return new Response('cached host')
      } }
    } },
    fetch: (_request, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
  })
  vm.runInContext(createOfflineWorker({ version: 'host-fixture', files: [{ path: 'index.html', sha256: sha('cached host') }] }), context)
  let response
  events.get('fetch')({ request: { url: 'https://host.test/', method: 'GET', mode: 'navigate' }, respondWith: (value) => {
    response = value
  } })
  assert.equal(await (await response).text(), 'cached host')
  assert.equal(deadline, 2000)
})
test('immutable application HTML uses cache first even on a hanging network; API requests are untouched', async () => {
  const events = new Map()
  let network = 0
  const context = vm.createContext({
    registration: { scope: 'https://apps.test/notes/digest/' },
    URL,
    addEventListener: (name, fn) => events.set(name, fn),
    caches: { async open() {
      return { async match() {
        return new Response('cached application')
      } }
    } },
    Response,
    crypto: webcrypto,
    Uint8Array,
    fetch: () => {
      network++
      return new Promise(() => {})
    },
  })
  vm.runInContext(createOfflineWorker({ version: 'fixture', application: true, files: [{ path: 'index.html', sha256: sha('cached application') }] }), context)
  let response
  events.get('fetch')({ request: { url: 'https://apps.test/notes/digest/', method: 'GET', mode: 'navigate' }, respondWith: (value) => {
    response = value
  } })
  assert.equal(await (await response).text(), 'cached application')
  assert.equal(network, 0)
  let intercepted = false
  events.get('fetch')({ request: { url: 'https://apps.test/api/v1/private', method: 'GET' }, respondWith: () => {
    intercepted = true
  } })
  assert.equal(intercepted, false)
})
