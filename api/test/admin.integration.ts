/** Real MySQL + local fake provider. Creates and removes only its own test rows. */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createCategoryRepository } from '@t-box/ledger-server/categories/repository'
import { createBillRepository } from '@t-box/ledger-server/repository'
import {
  createVault,
  hashPassword,
  verifyPassword,
} from '../src/admin/crypto.js'
import { DatabaseChatProvider } from '../src/admin/runtime.js'
import { ConfigurationService } from '../src/admin/service.js'
import { AdminStore } from '../src/admin/store.js'
import { createApp } from '../src/app.js'
import { createDataSource } from '../src/db/data-source.js'

const pool = await createDataSource().initialize()
const store = new AdminStore(pool)
const vault = createVault(randomBytes(32))
const service = new ConfigurationService(store, vault)
const app = createApp({
  bills: createBillRepository(pool),
  categories: createCategoryRepository(pool),
  health: async () => ({ mysql: 'up', redis: 'disabled' }),
  administration: service,
  adminOrigins: ['https://admin.example.com'],
  corsOrigins: ['http://localhost:5173', 'https://box.example.com'],
  chatProvider: new DatabaseChatProvider(service),
})
const marker = randomUUID()
const username = `test-${marker.slice(0, 8)}`
const password = 'integration-password-123'
const newPassword = 'new-integration-password-123'
const ids: {
  admin?: string
  secondAdmin?: string
  provider?: string
  model?: string
  imageModel?: string
} = {}
let settingsChanged = false
const original = await store.settings()
const remote = createServer(async (req, res) => {
  assert.equal(req.headers.authorization, 'Bearer integration-key')
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        object: 'list',
        data: [
          {
            id: 'image-test',
            object: 'model',
            created: 0,
            owned_by: 'local-test',
          },
          {
            id: 'test-model',
            object: 'model',
            created: 0,
            owned_by: 'local-test',
          },
        ],
      }),
    )
    return
  }
  if (req.url === '/v1/responses' || req.url === '/v1/chat/completions') {
    const chat = req.url === '/v1/chat/completions'
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk)
    }
    const body = JSON.parse(Buffer.concat(chunks).toString())
    assert.equal(body.model, 'test-model')
    const forced =
      typeof body.tool_choice === 'object'
        ? chat
          ? body.tool_choice.function.name
          : body.tool_choice.name
        : undefined
    const output = forced
      ? [
          {
            type: 'function_call',
            id: 'fc-test',
            call_id: 'call-test',
            name: forced,
            arguments:
              forced === 'workflow_plan'
                ? JSON.stringify({
                    route: 'answer',
                    summary: '直接回答普通会话。',
                    steps: [],
                    requiredTools: [],
                  })
                : '{}',
            status: 'completed',
          },
        ]
      : [
          {
            type: 'message',
            id: 'msg-test',
            role: 'assistant',
            status: 'completed',
            content: [
              { type: 'output_text', text: '配置已生效', annotations: [] },
            ],
          },
        ]
    res.setHeader('Content-Type', 'text/event-stream')
    if (chat) {
      assert.ok(Array.isArray(body.messages))
      assert.equal(body.stream_options.include_usage, true)
      assert.equal(body.input, undefined)
      const id = randomUUID()
      const first = output[0]!
      const delta = forced
        ? {
            tool_calls: [
              {
                index: 0,
                id,
                type: 'function',
                function: {
                  name: forced,
                  arguments: 'arguments' in first ? first.arguments : '{}',
                },
              },
            ],
          }
        : { content: '配置已生效' }
      res.end(
        `data: ${JSON.stringify({ id, choices: [{ index: 0, delta, finish_reason: forced ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      )
      return
    }

    if (!forced) {
      res.write(
        `data: ${JSON.stringify({
          type: 'response.output_text.delta',
          delta: '配置已生效',
        })}\n\n`,
      )
    }
    res.end(
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'resp-test',
          object: 'response',
          status: 'completed',
          output,
        },
      })}\n\ndata: [DONE]\n\n`,
    )
    return
  }
  res.writeHead(404).end()
})
await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve))
const port = (remote.address() as { port: number }).port
let cookie = ''
async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  payload?: Record<string, unknown>,
  authenticated = true,
) {
  return app.inject({
    method,
    url: `/api/v1/admin${path}`,
    headers: { 'x-admin-request': '1', ...(authenticated ? { cookie } : {}) },
    ...(payload === undefined ? {} : { payload }),
  })
}
try {
  const hash = await hashPassword(password)
  assert.notEqual(hash, password)
  assert.equal(await verifyPassword(password, hash), true)
  assert.equal(await verifyPassword('wrong', hash), false)
  ids.admin = await store.createUser(username, hash)
  assert.equal(
    (await call('GET', '/providers', undefined, false)).statusCode,
    401,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/session',
        payload: { username, password },
      })
    ).statusCode,
    403,
  )
  assert.equal(
    (await call('POST', '/session', { username, password: 'wrong' }, false))
      .statusCode,
    401,
  )
  const login = await call('POST', '/session', { username, password }, false)
  assert.equal(login.statusCode, 200)
  cookie = String(login.headers['set-cookie']).split(';')[0]!
  assert.match(String(login.headers['set-cookie']), /HttpOnly/)
  assert.match(String(login.headers['set-cookie']), /SameSite=Strict/)
  const preflight = await app.inject({ method: 'OPTIONS', url: '/api/v1/admin/session', headers: { 'origin': 'https://admin.example.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-admin-request' } })
  assert.equal(preflight.statusCode, 204, preflight.body)
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://admin.example.com')
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true')
  const crossSession = await app.inject({ method: 'GET', url: '/api/v1/admin/session', headers: { origin: 'https://admin.example.com', cookie } })
  assert.equal(crossSession.statusCode, 200, crossSession.body)
  assert.equal(crossSession.headers['access-control-allow-credentials'], 'true')
  for (const origin of ['https://evil.example.com', 'https://box.example.com', 'null']) {
    const denied = await app.inject({ method: 'POST', url: '/api/v1/admin/session', headers: { 'origin': origin, 'x-admin-request': '1' }, payload: { username, password } })
    assert.equal(denied.statusCode, 403, denied.body)
    assert.equal(denied.headers['set-cookie'], undefined)
    assert.equal(denied.headers['access-control-allow-credentials'], undefined)
  }
  const p = await call('POST', '/providers', {
    name: marker,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: 'integration-key',
    enabled: true,
  })
  assert.equal(p.statusCode, 201, p.body)
  ids.provider = p.json().data.id
  const list = await call('GET', '/providers')
  assert.ok(!list.body.includes('integration-key'))
  assert.ok(!list.body.includes('keyCipher'))
  const secret = await store.provider(ids.provider!)
  assert.notEqual(secret.keyCipher, 'integration-key')
  assert.equal(vault.decrypt(secret.keyCipher), 'integration-key')
  const discovered = await call('GET', `/providers/${ids.provider}/models`)
  assert.ok(discovered.json().data.some((m: any) => m.id === 'test-model'))
  const invalid = await call('POST', '/models', {
    providerId: ids.provider,
    modelId: 'invented',
    name: 'invalid',
    enabled: true,
  })
  assert.equal(invalid.statusCode, 400)
  const m = await call('POST', '/models', {
    providerId: ids.provider,
    modelId: 'test-model',
    name: marker,
    enabled: true,
    inputPrice: '1.25',
    outputPrice: '2.5',
  })
  assert.equal(m.statusCode, 201, m.body)
  ids.model = m.json().data.id
  const priced = (await call('GET', '/models'))
    .json()
    .data
    .find((row: { id: string }) => row.id === ids.model)
  assert.equal(priced.invocationMode, 'responses')
  assert.equal(priced.inputPrice, '1.250000')
  assert.equal(priced.outputPrice, '2.500000')
  assert.equal(
    (
      await call('PATCH', `/models/${ids.model}`, {
        providerId: ids.provider,
        modelId: 'test-model',
        name: marker,
        enabled: true,
        inputPrice: 1.5,
      })
    ).statusCode,
    400,
  )
  assert.equal(
    (await call('POST', `/models/${ids.model}/test`, {})).statusCode,
    200,
  )
  const selection = await call('PATCH', '/settings', { modelId: ids.model })
  assert.equal(selection.statusCode, 200)
  settingsChanged = true
  assert.equal((await service.runtime())?.model, 'test-model')
  const image = await call('POST', '/models', {
    providerId: ids.provider,
    modelId: 'image-test',
    name: '图片测试',
    enabled: true,
    purpose: 'image',
    imagePrice: '0.35',
  })
  assert.equal(image.statusCode, 201, image.body)
  ids.imageModel = image.json().data.id
  assert.equal(
    (await call('PATCH', '/settings', { imageModelId: ids.model })).statusCode,
    400,
  )
  assert.equal(
    (await call('PATCH', '/settings', { modelId: ids.imageModel })).statusCode,
    400,
  )
  assert.equal(
    (await call('PATCH', '/settings', { imageModelId: ids.imageModel }))
      .statusCode,
    200,
  )
  assert.equal((await service.runtime('image'))?.model, 'image-test')
  assert.equal((await service.runtime('image'))?.prices.imagePrice, '0.350000')
  // Even direct/inconsistent database selections cannot cross the runtime purpose boundary.
  await store.execute('UPDATE ai_settings SET model_id=? WHERE id=1', [
    ids.imageModel!,
  ])
  await assert.rejects(service.runtime(), { code: 'MODEL_PURPOSE_MISMATCH' })
  await store.execute('UPDATE ai_settings SET model_id=? WHERE id=1', [
    ids.model!,
  ])
  assert.equal((await service.runtime())?.model, 'test-model')
  assert.equal(
    (await call('DELETE', `/models/${ids.imageModel}`)).statusCode,
    400,
  )
  assert.equal(
    (await call('POST', `/models/${ids.imageModel}/test`, {})).statusCode,
    400,
  )
  const vision = await call('PATCH', `/models/${ids.model}`, {
    providerId: ids.provider,
    modelId: 'test-model',
    name: marker,
    enabled: true,
    purpose: 'conversation',
    supportsVision: true,
  })
  assert.equal(vision.statusCode, 200, vision.body)
  assert.equal((await service.runtime())?.supportsVision, true)
  assert.equal((await service.runtime())?.prices.inputPrice, '1.250000')

  assert.equal((await call('DELETE', `/models/${ids.model}`)).statusCode, 400)
  assert.equal(
    (
      await call('PATCH', `/providers/${ids.provider}`, {
        name: marker,
        baseUrl: secret.baseUrl,
        enabled: false,
      })
    ).statusCode,
    400,
  )
  assert.equal(
    (
      await call('PATCH', `/providers/${ids.provider}`, {
        name: marker,
        baseUrl: `http://localhost:${port}/v1`,
        enabled: true,
      })
    ).statusCode,
    400,
  )
  const socket = await app.injectWS('/api/v1/chat/ws', {
    headers: { origin: 'http://localhost:5173' },
  })
  const events: Record<string, any>[] = []
  socket.on('message', (raw) => events.push(JSON.parse(raw.toString())))
  async function wait(type: string) {
    for (let i = 0; i < 300; i++) {
      const event = events.find((e) => e.type === type)
      if (event) {
        return event
      }
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error(`No ${type}`)
  }
  socket.send(JSON.stringify({ type: 'session.open' }))
  assert.equal((await wait('session.ready')).snapshot.mode, 'openai')
  socket.send(
    JSON.stringify({
      type: 'message.send',
      requestId: randomUUID(),
      text: '你好',
      localDate: '2026-10-05',
    }),
  )
  const finished = await wait('run.finished')
  assert.equal(finished.status, 'completed')
  assert.match(finished.snapshot.messages.at(-1).content, /配置已生效/)
  socket.terminate()

  const chatUpdate = await call('PATCH', `/models/${ids.model}`, {
    providerId: ids.provider,
    modelId: 'test-model',
    name: marker,
    enabled: true,
    purpose: 'conversation',
    invocationMode: 'chat_completions',
    contextPolicy: {
      maxInputTokens: 32768,
      compaction: true,
      compactionMode: 'native',
      tokenCounting: true,
      promptCacheKey: false,
    },
  })
  assert.equal(chatUpdate.statusCode, 200, chatUpdate.body)
  const chatConfig = await service.runtime()
  assert.equal(chatConfig?.invocationMode, 'chat_completions')
  assert.equal(chatConfig?.contextPolicy.compactionMode, 'summary')
  assert.equal(chatConfig?.contextPolicy.tokenCounting, false)
  assert.equal(chatConfig?.prices.inputPrice, '1.250000')
  assert.equal((await service.runtime('image'))?.invocationMode, 'images')
  const chatProbe = await call('POST', `/models/${ids.model}/test`, {})
  assert.equal(chatProbe.statusCode, 200, chatProbe.body)
  assert.match(chatProbe.json().data.message, /Chat Completions/)
  const chatSocket = await app.injectWS('/api/v1/chat/ws', {
    headers: { origin: 'http://localhost:5173' },
  })
  const chatEvents: Record<string, any>[] = []
  chatSocket.on('message', (raw) =>
    chatEvents.push(JSON.parse(raw.toString())))
  chatSocket.send(JSON.stringify({ type: 'session.open' }))
  for (
    let i = 0;
    i < 300 && !chatEvents.some((e) => e.type === 'session.ready');
    i++
  ) {
    await new Promise((r) => setTimeout(r, 10))
  }
  chatSocket.send(
    JSON.stringify({
      type: 'message.send',
      requestId: randomUUID(),
      text: '你好',
      localDate: '2026-10-08',
    }),
  )
  for (
    let i = 0;
    i < 300 && !chatEvents.some((e) => e.type === 'run.finished');
    i++
  ) {
    await new Promise((r) => setTimeout(r, 10))
  }
  const chatFinal = chatEvents.find((e) => e.type === 'run.finished')
  assert.equal(chatFinal?.status, 'completed', JSON.stringify(chatFinal))
  assert.match(chatFinal.snapshot.messages.at(-1).content, /配置已生效/)
  chatSocket.terminate()
  assert.equal(
    (
      await call('PATCH', `/models/${ids.model}`, {
        providerId: ids.provider,
        modelId: 'test-model',
        name: marker,
        enabled: true,
        invocationMode: 'images',
      })
    ).statusCode,
    400,
  )
  await call('PATCH', '/settings', {
    modelId: original.modelId,
    imageModelId: original.imageModelId,
  })
  settingsChanged = false
  const secondUser = `${username}-second`
  const createdUser = await call('POST', '/users', {
    username: secondUser,
    password,
  })
  assert.equal(createdUser.statusCode, 201)
  ids.secondAdmin = createdUser.json().data.id
  const secondLogin = await call(
    'POST',
    '/session',
    { username: secondUser, password },
    false,
  )
  assert.equal(secondLogin.statusCode, 200)
  const secondCookie = String(secondLogin.headers['set-cookie']).split(';')[0]!
  assert.equal(
    (await call('PATCH', `/users/${ids.secondAdmin}`, { enabled: false }))
      .statusCode,
    204,
  )
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/admin/session',
        headers: { cookie: secondCookie },
      })
    ).statusCode,
    401,
  )
  assert.equal(
    (await call('POST', '/session', { username: secondUser, password }, false))
      .statusCode,
    401,
  )
  assert.equal(
    (await call('PATCH', `/users/${ids.secondAdmin}`, { enabled: true }))
      .statusCode,
    204,
  )
  assert.equal(
    (await call('POST', '/session', { username: secondUser, password }, false))
      .statusCode,
    200,
  )
  assert.equal(
    (await call('PATCH', `/users/${ids.admin}`, { enabled: false })).statusCode,
    400,
  )
  assert.equal(
    (
      await call('PATCH', '/password', {
        currentPassword: password,
        newPassword,
      })
    ).statusCode,
    204,
  )
  assert.equal((await call('GET', '/session')).statusCode, 401)
  assert.equal(
    (await call('POST', '/session', { username, password }, false)).statusCode,
    401,
  )
  const relogin = await call(
    'POST',
    '/session',
    { username, password: newPassword },
    false,
  )
  assert.equal(relogin.statusCode, 200)
  cookie = String(relogin.headers['set-cookie']).split(';')[0]!
  assert.equal((await call('DELETE', '/session')).statusCode, 204)
  assert.equal((await call('GET', '/providers')).statusCode, 401)
  console.log(
    'PASS: auth/CSRF/revocation, encrypted credentials, independent config, models discovery, Responses/Chat Completions probes and DB-backed WebSocket runtime and dependency guards',
  )
} finally {
  if (settingsChanged) {
    await store.execute(
      'UPDATE ai_settings SET model_id=?,image_model_id=? WHERE id=1',
      [original.modelId, original.imageModelId],
    )
  }
  if (ids.imageModel) {
    await store.execute('DELETE FROM ai_models WHERE id=?', [ids.imageModel])
  }
  if (ids.model) {
    await store.execute('DELETE FROM ai_models WHERE id=?', [ids.model])
  }
  if (ids.provider) {
    await store.execute('DELETE FROM ai_providers WHERE id=?', [ids.provider])
  }
  if (ids.secondAdmin) {
    await store.execute('DELETE FROM admin_users WHERE id=?', [
      ids.secondAdmin,
    ])
  }
  if (ids.admin) {
    await store.execute('DELETE FROM admin_users WHERE id=?', [ids.admin])
  }
  await app.close()
  remote.closeAllConnections()
  await new Promise<void>((resolve) => remote.close(() => resolve()))
  await pool.destroy()
  console.log('Owned test records removed; original chat selection restored.')
}
