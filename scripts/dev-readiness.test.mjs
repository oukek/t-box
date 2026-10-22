import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { waitForApi } from './dev-readiness.mjs'

async function fixture(t, handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}/api/v1/health`
}

test('frontend readiness waits through database startup and permits an unavailable optional Redis cache', async (t) => {
  let requests = 0
  const url = await fixture(t, (_request, response) => {
    requests++
    response.setHeader('Content-Type', 'application/json')
    response.statusCode = requests < 3 ? 503 : 200
    response.end(JSON.stringify({ data: { dependencies: { mysql: requests < 3 ? 'down' : 'up', redis: 'down' } } }))
  })
  await waitForApi({ url, timeout: 2000, interval: 5 })
  assert.equal(requests, 3)
})

test('a listening HTTP server with unrelated content is not a ready T Box API', async (t) => {
  const url = await fixture(t, (_request, response) => response.end('{}'))
  await assert.rejects(waitForApi({ url, timeout: 100, interval: 5 }), /API.*未就绪/)
})

test('stopping development cancels readiness instead of starting frontend services later', async (t) => {
  const controller = new AbortController()
  const url = await fixture(t, (_request, response) => {
    response.statusCode = 503
    response.end()
    controller.abort()
  })
  await assert.rejects(waitForApi({ url, signal: controller.signal }), { name: 'AbortError' })
})
