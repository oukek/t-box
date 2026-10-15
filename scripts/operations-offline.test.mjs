import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import test from 'node:test'
import vm from 'node:vm'
import { createOfflineWorker } from './offline-worker.mjs'

test('offline installation verifies every static byte, retains the prior version on failure, and never caches API/private data', async () => {
  const bytes = { 'index.html': '<html>public shell</html>', 'assets/app.js': 'console.info("public")' }
  const files = Object.entries(bytes).map(([path, value]) => ({ path, sha256: createHash('sha256').update(value).digest('hex') }))
  const stores = new Map([['tbox-static-v1:/:previous', new Map()]])
  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        stores.set(name, new Map())
      }
      const store = stores.get(name)
      return { async put(url, response) {
        store.set(url, response.clone())
      }, async match(url) {
        return store.get(url)?.clone()
      } }
    },
    async delete(name) {
      return stores.delete(name)
    },
    async keys() {
      return [...stores.keys()]
    },
  }
  let corrupt = true
  let offline = false
  let fetched = 0
  const events = new Map()
  const context = vm.createContext({
    registration: { scope: 'https://host.test/' },
    addEventListener: (name, handler) => events.set(name, handler),
    caches,
    URL,
    Uint8Array,
    crypto: webcrypto,
    Response,
    fetch: async (input, options) => {
      fetched++
      if (offline) {
        throw new Error('offline')
      }
      assert.equal(options.credentials, 'omit')
      const path = new URL(input).pathname.slice(1)
      return new Response(corrupt && path.endsWith('.js') ? 'changed' : bytes[path])
    },
  })
  vm.runInContext(createOfflineWorker({ version: 'fixture', files }), context)
  let install
  events.get('install')({ waitUntil: (value) => {
    install = value
  } })
  await assert.rejects(install, /integrity/)
  assert.deepEqual([...stores.keys()], ['tbox-static-v1:/:previous'])
  corrupt = false
  events.get('install')({ waitUntil: (value) => {
    install = value
  } })
  await install
  assert.equal(stores.get('tbox-static-v1:/:fixture').size, 2)
  const dispatch = (url, method = 'GET', mode = 'cors') => {
    let handled
    events.get('fetch')({ request: { url, method, mode }, respondWith: (value) => {
      handled = value
    } })
    return handled
  }
  const before = fetched
  offline = true
  assert.equal(dispatch('https://host.test/api/v1/auth/me'), undefined)
  assert.equal(dispatch('https://host.test/api/v1/resources/private'), undefined)
  assert.equal(dispatch('https://other.test/assets/app.js'), undefined)
  assert.equal(dispatch('https://host.test/assets/app.js', 'POST'), undefined)
  assert.equal(await (await dispatch('https://host.test/assets/app.js')).text(), bytes['assets/app.js'])
  assert.equal(fetched, before)
  assert.equal(await (await dispatch('https://host.test/', 'GET', 'navigate')).text(), bytes['index.html'])
})
