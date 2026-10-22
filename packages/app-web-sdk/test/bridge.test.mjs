import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectAppClient } from '../dist/index.js'

const context = {
  sdkVersion: 1,
  appId: 'fixture',
  releaseId: 'fixture-1',
  generation: 1,
  subject: 'scoped-subject',
  params: {},
  runtime: 'web',
  platform: 'web',
  permissions: ['storage'],
  capabilities: [
    'runtime.context',
    'auth.session',
    'api.invoke',
    'storage.get',
    'storage.set',
    'storage.remove',
  ],
}
function host(handler, sdkContext = context, referrer = 'https://host.example/app') {
  const handlers = new Set()
  const parent = {}
  globalThis.window = {
    parent,
    addEventListener(type, callback) {
      if (type === 'message') {
        handlers.add(callback)
      }
    },
    removeEventListener(type, callback) {
      handlers.delete(callback)
    },
  }
  globalThis.location = { hash: '#tbox-host=https%3A%2F%2Fhost.example', origin: 'https://app.example' }
  globalThis.document = { referrer }
  const channel = new MessageChannel()
  const messages = []
  channel.port1.onmessage = async ({ data }) => {
    messages.push(data)
    if (data.type !== 'request') {
      return
    }
    if (data.method === 'runtime.context') {
      channel.port1.postMessage({
        type: 'response',
        id: data.id,
        ok: true,
        data: sdkContext,
      })
    } else {
      await handler?.(data, channel.port1)
    }
  }
  return {
    messages,
    async connect(tools = {}) {
      const promise = connectAppClient(tools)
      // Same data from a sibling or a different origin cannot take ownership of the channel.
      for (const accept of handlers) {
        accept({
          source: {},
          origin: 'https://host.example',
          data: { type: 'tbox.connect', protocol: 1, nonce: 'nonce' },
          ports: [channel.port2],
        })
        accept({
          source: parent,
          origin: 'https://attacker.example',
          data: { type: 'tbox.connect', protocol: 1, nonce: 'nonce' },
          ports: [channel.port2],
        })
      }
      assert.equal(handlers.size, 1)
      for (const accept of handlers) {
        accept({
          source: parent,
          origin: 'https://host.example',
          data: {
            type: 'tbox.connect',
            protocol: 1,
            nonce: 'nonce',
            context: sdkContext,
          },
          ports: [channel.port2],
        })
      }
      const result = await promise
      assert.equal(handlers.size, 0)
      return result
    },
    send(event) {
      channel.port1.postMessage(event)
    },
    close() {
      channel.port1.close()
      channel.port2.close()
      delete globalThis.window
      delete globalThis.document
      delete globalThis.location
    },
  }
}
test('web client shares facade and preserves structured errors and explicit write keys', async () => {
  const h = host(async (request, port) =>
    port.postMessage({
      type: 'response',
      id: request.id,
      ok: false,
      failure: { code: 'APP_PERMISSION_DENIED', message: '拒绝', status: 403 },
    }),
  )
  let connection
  try {
    connection = await h.connect()
    assert.equal(connection.context.subject, context.subject)
    assert.equal('token' in connection.context, false)
    await assert.rejects(
      connection.client.api.invoke('echo', {}, { idempotencyKey: 'retry-key' }),
      (e) => e.code === 'APP_PERMISSION_DENIED' && e.status === 403,
    )
    assert.equal(
      h.messages.find((m) => m.method === 'api.invoke').options.idempotencyKey,
      'retry-key',
    )
  } finally {
    connection?.client.dispose()
    h.close()
  }
})
test('host closure immediately rejects pending requests instead of waiting for timeout', async () => {
  const h = host()
  let connection
  try {
    connection = await h.connect()
    const pending = connection.client.api.invoke('slow', {})
    h.send({
      type: 'event',
      name: 'runtime.closed',
      data: { code: 'APP_RUNTIME_EXPIRED', message: '已卸载' },
    })
    await assert.rejects(pending, (e) => e.code === 'APP_RUNTIME_EXPIRED')
  } finally {
    connection?.client.dispose()
    h.close()
  }
})
test('unsupported SDK version closes handshake resources', async () => {
  const h = host(undefined, { ...context, sdkVersion: 999 })
  try {
    await assert.rejects(h.connect(), (e) => e.code === 'PROTOCOL_MISMATCH')
  } finally {
    h.close()
  }
})
test('frontend tools keep their registration protocol alongside SDK calls', async () => {
  const h = host()
  let connection
  try {
    connection = await h.connect({ fill: (args) => ({ value: args.value }) })
    connection.ready()
    h.send({
      type: 'request',
      id: 'tool-1',
      method: 'fill',
      args: { value: 42 },
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(h.messages.find((m) => m.type === 'ready').tools, [
      'fill',
    ])
    assert.deepEqual(h.messages.find((m) => m.id === 'tool-1').data, {
      value: 42,
    })
  } finally {
    connection?.client.dispose()
    h.close()
  }
})

test('file requests and app invocations have separate bounded budgets', async () => {
  const f = host(async (data, port) => {
    port.postMessage({ type: 'response', id: data.id, ok: true, data: { accepted: true } })
  })
  const connected = await f.connect()
  try {
    assert.deepEqual(await connected.client.api.request('/ledgers/book/attachment-resources', {
      method: 'POST',
      body: { base64: 'a'.repeat(100_000) },
    }), { accepted: true })
    assert.deepEqual(await connected.client.api.invoke('project_save', { frames: Array.from({ length: 1000 }, (_, id) => ({ id, caption: 'a'.repeat(200) })) }), { accepted: true })
    await assert.rejects(connected.client.api.invoke('project_save', { padding: 'a'.repeat(1024 * 1024) }), /过大/)
    await assert.rejects(connected.client.api.request('/ledgers/book/attachment-resources', {
      method: 'POST',
      body: { base64: 'a'.repeat(15 * 1024 * 1024) },
    }), /过大/)
  } finally {
    connected.client.dispose()
    f.close()
  }
})

test('iframe self reload preserves its original host origin while foreign referrers are rejected', async () => {
  const reloaded = host(undefined, context, 'https://app.example/')
  try {
    const connection = await reloaded.connect()
    assert.equal(connection.context.subject, context.subject)
    connection.client.dispose()
  } finally {
    reloaded.close()
  }
  const foreign = host(undefined, context, 'https://foreign.example/')
  try {
    await assert.rejects(connectAppClient(), /来源无效/)
  } finally {
    foreign.close()
  }
})

test('navigation ownership is an explicit optional ready declaration; legacy apps keep their host header', async () => {
  for (const ownsHeader of [false, true]) {
    const h = host(undefined, { ...context, supportsAppNavigation: true })
    let connection
    try {
      connection = await h.connect()
      if (ownsHeader) {
        connection.ready({ appNavigation: true })
      } else {
        connection.ready()
      }
      for (let i = 0; i < 50 && !h.messages.some((message) => message.type === 'ready'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      const ready = h.messages.find((message) => message.type === 'ready')
      assert.ok(ready)
      assert.equal(ready.appNavigation, ownsHeader ? true : undefined)
      assert.equal(ready.nonce, 'nonce')
    } finally {
      connection?.client.dispose()
      h.close()
    }
  }
})
