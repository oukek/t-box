import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AppSdkError, createAppClient } from '../dist/index.js'

function fixture(handler = async () => null) {
  const listeners = new Set()
  const calls = []
  let closeCount = 0
  const transport = {
    async call(method, args, options) {
      calls.push({ method, args, options })
      return handler(method, args, options)
    },
    listen(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      closeCount++
    },
  }
  return {
    client: createAppClient(transport),
    calls,
    listeners,
    emit(name, data) {
      for (const listener of listeners) {
        listener({ type: 'event', name, data })
      }
    },
    get closeCount() {
      return closeCount
    },
  }
}
test('app API passes cancellation and explicit idempotency without exposing credentials', async () => {
  const f = fixture(async () => ({ value: 42 }))
  assert.deepEqual(
    await f.client.api.invoke(
      'calculate',
      { expression: '6*7' },
      { idempotencyKey: 'retry-1' },
    ),
    { value: 42 },
  )
  assert.equal(f.calls[0].method, 'api.invoke')
  assert.deepEqual(f.calls[0].args, {
    method: 'calculate',
    arguments: { expression: '6*7' },
  })
  assert.equal(f.calls[0].options.idempotencyKey, 'retry-1')
  assert.ok(f.calls[0].options.signal instanceof AbortSignal)
  assert.equal('token' in f.client.auth, false)
  f.client.dispose()
})
test('structured authorization errors retain code and status', async () => {
  const f = fixture(async () => {
    // eslint-disable-next-line no-throw-literal -- Hosts may reject with structured non-Error payloads.
    throw { code: 'APP_PERMISSION_DENIED', message: '无权限', status: 403 }
  })
  await assert.rejects(
    f.client.api.invoke('write', {}),
    (e) =>
      e instanceof AppSdkError &&
      e.code === 'APP_PERMISSION_DENIED' &&
      e.status === 403,
  )
  f.client.dispose()
})
test('ensureSignedIn refuses restoring or logged-out identity', async () => {
  for (const status of ['restoring', 'signed_out']) {
    const f = fixture(async () => ({ status, subject: null }))
    await assert.rejects(
      f.client.auth.ensureSignedIn(),
      (e) => e.code === 'AUTH_REQUIRED',
    )
    f.client.dispose()
  }
})
test('cancelled request settles even when transport ignores abort', async () => {
  const f = fixture(() => new Promise(() => {}))
  const controller = new AbortController()
  const result = f.client.api.invoke('slow', {}, { signal: controller.signal })
  controller.abort()
  await assert.rejects(result, (e) => e.code === 'REQUEST_CANCELLED')
  assert.equal(f.calls[0].options.signal.aborted, true)
  f.client.dispose()
})
test('pre-aborted request never reaches transport', async () => {
  const f = fixture()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    f.client.api.invoke('write', {}, { signal: controller.signal }),
    (e) => e.code === 'REQUEST_CANCELLED',
  )
  assert.equal(f.calls.length, 0)
  f.client.dispose()
})
test('timeout never automatically retries a write', async () => {
  const f = fixture(() => new Promise(() => {}))
  await assert.rejects(
    f.client.api.invoke('write', {}, { timeoutMs: 5 }),
    (e) => e.code === 'REQUEST_TIMEOUT',
  )
  assert.equal(f.calls.length, 1)
  f.client.dispose()
})
test('logout cancels in-flight operations and notifies subscribers', async () => {
  const f = fixture(() => new Promise(() => {}))
  let session
  const stop = f.client.auth.onChange((value) => {
    session = value
  })
  const result = f.client.api.invoke('write', {})
  f.emit('auth.changed', { status: 'signed_out', subject: null })
  await assert.rejects(result, (e) => e.code === 'SESSION_CHANGED')
  assert.deepEqual(session, { status: 'signed_out', subject: null })
  stop()
  f.client.dispose()
})
test('dispose is idempotent and cancels pending calls and transport listeners', async () => {
  const f = fixture(() => new Promise(() => {}))
  let reason
  f.client.runtime.onClose((e) => {
    reason = e
  })
  const result = f.client.api.invoke('write', {})
  f.client.dispose()
  f.client.dispose()
  await assert.rejects(result, (e) => e.code === 'APP_CLOSED')
  await assert.rejects(
    f.client.storage.get('key'),
    (e) => e.code === 'APP_CLOSED',
  )
  assert.equal(reason.code, 'APP_CLOSED')
  assert.equal(f.closeCount, 1)
  assert.equal(f.listeners.size, 0)
})
test('events arriving before subscription acknowledgment are delivered in order', async () => {
  const values = []
  const f = fixture(async (method, args) => {
    if (method === 'events.subscribe') {
      f.emit('app.event', { subscriptionId: args.subscriptionId, value: 1 })
      f.emit('app.event', { subscriptionId: args.subscriptionId, value: 2 })
    }
    return null
  })
  const stop = await f.client.events.subscribe('books', {}, (value) =>
    values.push(value))
  const id = f.calls[0].args.subscriptionId
  stop()
  stop()
  f.emit('app.event', { subscriptionId: id, value: 3 })
  assert.deepEqual(values, [1, 2])
  assert.equal(
    f.calls.filter((c) => c.method === 'events.unsubscribe').length,
    1,
  )
  f.client.dispose()
})
test('runtime closure clears event subscriptions and notifies lifecycle', async () => {
  const f = fixture()
  const values = []
  const controller = new AbortController()
  await f.client.events.subscribe('books', {}, (value) => values.push(value), {
    signal: controller.signal,
  })
  const id = f.calls[0].args.subscriptionId
  f.emit('runtime.closed', { code: 'APP_RUNTIME_EXPIRED', message: '已卸载' })
  f.emit('app.event', { subscriptionId: id, value: 'late' })
  controller.abort()
  await assert.rejects(
    f.client.runtime.getContext(),
    (e) => e.code === 'APP_CLOSED',
  )
  assert.deepEqual(values, [])
  assert.equal(f.closeCount, 1)
  assert.equal(
    f.calls.filter((c) => c.method === 'events.unsubscribe').length,
    0,
  )
})
test('session switch retires subscriptions and reports the reason', async () => {
  const f = fixture()
  const values = []
  let error
  await f.client.events.subscribe('books', {}, (value) => values.push(value), {
    onError: (e) => {
      error = e
    },
  })
  const id = f.calls[0].args.subscriptionId
  f.emit('auth.changed', { status: 'signed_in', subject: 'new-user' })
  f.emit('app.event', { subscriptionId: id, value: 'old-account-event' })
  assert.equal(error.code, 'SESSION_CHANGED')
  assert.deepEqual(values, [])
  f.client.dispose()
})
test('failed subscription removes callbacks and performs cleanup', async () => {
  const f = fixture(async (method) => {
    if (method === 'events.subscribe') {
      throw new AppSdkError('PERMISSION_DENIED', '拒绝')
    }
  })
  let received = false
  await assert.rejects(
    f.client.events.subscribe('secret', {}, () => {
      received = true
    }),
    (e) => e.code === 'PERMISSION_DENIED',
  )
  f.emit('app.event', {
    subscriptionId: f.calls[0].args.subscriptionId,
    value: 1,
  })
  assert.equal(received, false)
  f.client.dispose()
})
test('storage CRUD and capability detection use the same public protocol', async () => {
  const f = fixture(async (method) =>
    method === 'runtime.context' ? { capabilities: ['storage.get'] } : null,
  )
  assert.equal(await f.client.runtime.supports('storage.get'), true)
  assert.equal(await f.client.runtime.supports('events.subscribe'), false)
  await f.client.storage.get('a')
  await f.client.storage.set('a', 1)
  await f.client.storage.remove('a')
  assert.deepEqual(
    f.calls.slice(2).map((c) => c.method),
    ['storage.get', 'storage.set', 'storage.remove'],
  )
  f.client.dispose()
})

test('scoped HTTP, stable mutations and resource bindings share the authenticated host transport', async () => {
  const f = fixture(async () => ({ data: { id: 'book' } }))
  await f.client.api.request('/ledgers', { method: 'GET' })
  await f.client.api.mutate('/ledgers/book', 'PATCH', { name: '新名称' })
  await f.client.resources.setBindings([{ appId: 'ledger', resourceType: 'book', resourceId: 'book' }])
  assert.equal(f.calls[0].method, 'api.request')
  assert.deepEqual(f.calls[1].args, { path: '/ledgers/book', method: 'PATCH', body: { name: '新名称' }, stable: true })
  assert.equal(f.calls[2].method, 'resources.bindings')
  assert.ok(!JSON.stringify(f.calls.map((v) => v.args)).includes('Authorization'))
  f.client.dispose()
})

test('navigation and interaction cancellation events stop on runtime disposal', () => {
  const f = fixture()
  const received = []
  f.client.runtime.onNavigate((params) => received.push(params))
  f.client.runtime.onInteractionCancel(() => received.push('cancelled'))
  f.emit('runtime.navigation', { ledgerId: 'book' })
  f.emit('runtime.interactions.cancelled', {})
  f.client.dispose()
  f.emit('runtime.navigation', { ledgerId: 'stale' })
  assert.deepEqual(received, [{ ledgerId: 'book' }, 'cancelled'])
})

test('reminder SDK delegates fixed operations to the host without receiving native handles', async () => {
  const f = fixture(async () => ({ platform: 'android', state: 'granted' }))
  assert.deepEqual(await f.client.device.reminders('sync'), { platform: 'android', state: 'granted' })
  assert.equal(f.calls[0].method, 'device.reminders')
  assert.deepEqual(f.calls[0].args, { action: 'sync' })
  f.client.dispose()
})

test('file SDK transports bounded binary content and exposes no host file path or bearer token', async () => {
  const file = { id: 'fixture', name: 'file.bin', mimeType: 'application/octet-stream', size: 3, source: 'uploaded', createdAt: '2026-10-15T00:00:00Z' }
  const f = fixture(async (method, args) => {
    if (method === 'files.upload') {
      assert.deepEqual(Buffer.from(args.base64, 'base64'), Buffer.from([0, 128, 255]))
      return file
    }
    return method === 'files.pick' ? [file] : { file, base64: Buffer.from([0, 128, 255]).toString('base64') }
  })
  const binary = new Blob([new Uint8Array([0, 128, 255])])
  assert.deepEqual(await f.client.files.upload(binary), file)
  assert.deepEqual(await f.client.files.pick({ multiple: true }), [file])
  const content = await f.client.files.read(file.id)
  assert.deepEqual(Buffer.from(await content.blob.arrayBuffer()), Buffer.from([0, 128, 255]))
  assert.equal(f.calls.length, 3)
  await assert.rejects(f.client.files.upload(new Blob([])), { code: 'FILE_SIZE' })
  assert.equal(f.calls.length, 3)
  f.client.dispose()
})
