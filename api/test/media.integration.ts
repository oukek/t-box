import type { ChatServerEvent } from '@t-box/shared'
import type { ConfigurationService } from '../src/admin/service.js'
import type {
  ChatProvider,
  ProviderInput,
  ProviderTurn,
} from '../src/chat/provider.js'
/** Real database, private files and a local fake Images API. No paid model calls. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { createApp } from '../src/app.js'
import { ApplicationChatService as ChatService } from '../src/bootstrap/chat.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const users: string[] = []
const services: ChatService[] = []
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=',
  'base64',
)
let invalidOutput = false
const imageRequests: { path: string, body: string }[] = []
const remote = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  assert.equal(req.headers.authorization, 'Bearer fake-media-key')
  imageRequests.push({
    path: req.url!,
    body: Buffer.concat(chunks).toString(),
  })
  res.setHeader('Content-Type', 'application/json')
  res.end(
    JSON.stringify({
      created: 0,
      data: [
        {
          b64_json: (invalidOutput
            ? Buffer.from('not an image')
            : png
          ).toString('base64'),
        },
      ],
    }),
  )
})
await new Promise<void>((r) => remote.listen(0, '127.0.0.1', r))
const configuration = {
  runtime: async (purpose: string) => {
    assert.equal(purpose, 'image')
    return {
      apiKey: 'fake-media-key',
      model: 'image-fixture',
      billingModelId: '00000000-0000-4000-8000-000000000002',
      prices: { inputPrice: '0', outputPrice: '0', imagePrice: '0' },
      baseURL: `http://127.0.0.1:${(remote.address() as { port: number }).port}/v1`,
    }
  },
} as unknown as ConfigurationService
const p = new PlatformService(source, configuration)
const app = createApp({
  platform: p,
  bills: createBillRepository(source),
  health: async () => ({ mysql: 'up', redis: 'disabled' }),
})
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('Media integration timed out')
    }
    await new Promise((r) => setTimeout(r, 5))
  }
}
function step(name: string, args: unknown): ProviderTurn {
  const id = randomUUID()
  const arguments_ = JSON.stringify(args)
  return {
    calls: [{ id, name, arguments: arguments_ }],
    output: [
      { type: 'function_call', call_id: id, name, arguments: arguments_ },
    ],
  }
}
const done: ProviderTurn = {
  calls: [],
  output: [{ role: 'assistant', content: '完成' }],
}
function setup(provider: ChatProvider) {
  const events: ChatServerEvent[] = []
  const service = new ChatService({
    platform: p,
    provider,
    bills: createBillRepository(source),
  })
  services.push(service)
  const connection = service.connect((e) => events.push(structuredClone(e)))
  return { service, connection, events }
}
try {
  const first = await p.identity.register(
    {
      username: `media_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
      nickname: '资源测试',
    },
    'media-fixture',
  )
  users.push(first.user.id)
  const second = await p.identity.register(
    {
      username: `media_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
    },
    'media-fixture',
  )
  users.push(second.user.id)
  const actor = await p.identity.authenticate(first.token)
  const other = await p.identity.authenticate(second.token)
  const upload = await app.inject({
    method: 'POST',
    url: '/api/v1/resources',
    headers: {
      'authorization': `Bearer ${first.token}`,
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent('测试.png'),
    },
    payload: png,
  })
  assert.equal(upload.statusCode, 201, upload.body)
  const image = upload.json().data
  assert.equal(image.mimeType, 'image/png')
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { 'content-type': 'application/octet-stream' },
        payload: png,
      })
    ).statusCode,
    401,
  )
  const content = await app.inject({
    method: 'GET',
    url: `/api/v1/resources/${image.id}/content`,
    headers: { authorization: `Bearer ${first.token}` },
  })
  assert.equal(content.statusCode, 200)
  assert.equal(content.headers['cache-control'], 'private, no-store')
  assert.deepEqual(content.rawPayload, png)
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/resources/${image.id}/content`,
        headers: { authorization: `Bearer ${second.token}` },
      })
    ).statusCode,
    404,
  )
  await assert.rejects(p.resources.attachments(other, [image.id]), /不可访问/)
  await assert.rejects(
    p.resources.attachments(actor, [image.id, image.id]),
    /4 个不同/,
  )
  const plain = await p.resources.create(
    actor,
    '笔记.md',
    Buffer.from('附件文本'),
  )
  assert.equal(plain.mimeType, 'text/plain')
  await assert.rejects(
    p.resources.create(actor, 'bad.exe', Buffer.from([0, 1, 2, 3])),
    /支持/,
  )
  await assert.rejects(
    p.resources.create(actor, 'large.png', Buffer.alloc(10 * 1024 * 1024 + 1)),
    /10 MB/,
  )
  await source.query('UPDATE resources SET size=? WHERE id=?', [
    300 * 1024 * 1024,
    plain.id,
  ])
  await assert.rejects(
    p.resources.create(actor, 'quota.txt', Buffer.from('x')),
    /资源空间已满/,
  )
  await source.query('UPDATE resources SET size=? WHERE id=?', [
    plain.size,
    plain.id,
  ])
  const generated = await p.images.forRun(
    actor,
    new AbortController().signal,
  )({ prompt: '画一张图片' })
  assert.equal(generated.resources[0]!.source, 'generated')
  const edited = await p.images.forRun(actor, new AbortController().signal)(
    { prompt: '修改颜色', resourceIds: [image.id] },
    true,
  )
  assert.equal(edited.resources[0]!.source, 'generated')
  assert.equal(imageRequests[0]!.path, '/v1/images/generations')
  assert.equal(JSON.parse(imageRequests[0]!.body).model, 'image-fixture')
  assert.equal(imageRequests[1]!.path, '/v1/images/edits')
  assert.ok(imageRequests[1]!.body.includes('image-fixture'))
  invalidOutput = true
  await assert.rejects(
    p.images.forRun(
      actor,
      new AbortController().signal,
    )({ prompt: '无效测试' }),
    /有效图片/,
  )
  invalidOutput = false
  let loopIndex = 0
  const imageCount = imageRequests.length
  const images = setup({
    mode: 'openai',
    async next() {
      return (
        [
          step('skill_activate', { skillId: 'image_processing' }),
          step('images_edit', {
            prompt: '编辑未附加图片',
            resourceIds: [generated.resources[0]!.id],
          }),
          step('images_generate', { prompt: '工具生成测试' }),
          step('images_generate', { prompt: '工具生成测试' }),
        ][loopIndex++] || done
      )
    },
  })
  await images.connection.receive({
    type: 'session.open',
    authToken: first.token,
  })
  await images.connection.receive({
    type: 'message.send',
    requestId: randomUUID(),
    text: '请生成一张图片',
    localDate: '2026-10-05',
  })
  await until(() => images.events.some((e) => e.type === 'run.finished'))
  const imagesFinished = images.events.find((e) => e.type === 'run.finished')!
  const previews = images.events.filter(
    (e) => e.type === 'tool.update' && e.tool.preview,
  )
  assert.ok(
    previews.some(
      (e) =>
        e.type === 'tool.update' &&
        e.tool.name === 'images_generate' &&
        e.tool.status === 'running',
    ),
  )
  assert.ok(
    !previews.some(
      (e) => e.type === 'tool.update' && e.tool.name === 'images_edit',
    ),
    'rejected validation must not start an image preview',
  )
  const delivered = images.events.findIndex(
    (e) =>
      e.type === 'tool.update' &&
      e.tool.status === 'completed' &&
      !!e.attachments?.length,
  )
  assert.ok(
    delivered >= 0 &&
    delivered < images.events.findIndex((e) => e.type === 'run.finished'),
    'images must reach the frontend before the final answer',
  )
  assert.equal(
    imagesFinished.snapshot.messages.at(-1)!.attachments?.length,
    1,
    `重复生成工具调用只保留一张附件: ${JSON.stringify({
      status: imagesFinished.status,
      task: imagesFinished.snapshot.task?.status,
      message: imagesFinished.snapshot.messages.at(-1)?.content,
      tools: imagesFinished.snapshot.messages.at(-1)?.toolCalls,
    })}`,
  )
  assert.equal(
    imagesFinished.snapshot.messages
      .at(-1)!
      .toolCalls
      .find((t) => t.name === 'images_edit')!.status,
    'failed',
  )
  assert.equal(
    imageRequests.length,
    imageCount + 1,
    '同一轮重复生成不能重复产生图片费用',
  )
  images.connection.close()
  await images.service.close()
  let observed = false
  const look = setup({
    mode: 'openai',
    configurationKey: 'fixture',
    async next(input: ProviderInput) {
      const json = JSON.stringify(input.history)
      assert.ok(json.includes('data:image/png;base64,'))
      assert.ok(json.includes('附件文本'))
      observed = true
      input.onDelta('看到了附件')
      return done
    },
  })
  await look.connection.receive({
    type: 'session.open',
    authToken: first.token,
  })
  const requestId = randomUUID()
  const request = {
    type: 'message.send',
    requestId,
    text: '看看附件',
    localDate: '2026-10-05',
    attachmentIds: [image.id, plain.id],
    applicationIds: ['ledger'],
  }
  await look.connection.receive(request)
  await until(() => look.events.some((e) => e.type === 'run.finished'))
  assert.ok(observed)
  const finished = look.events.find((e) => e.type === 'run.finished')!
  assert.equal(finished.type, 'run.finished')
  const conversationId = finished.snapshot.conversationId!
  assert.ok(conversationId)
  assert.equal(finished.snapshot.messages[0]!.attachments?.length, 2)
  assert.deepEqual(finished.snapshot.messages[0]!.applicationIds, ['ledger'])
  const [row] = await source.query(
    'SELECT state_json FROM conversations WHERE id=?',
    [conversationId],
  )
  assert.ok(row.state_json.includes(`asset:${image.id}`))
  assert.ok(!row.state_json.includes('data:image/png;base64,'))
  assert.ok(!row.state_json.includes('附件文本'))
  look.connection.close()
  await look.service.close()
  const oldTransport = look.events.find((e) => e.type === 'session.ready')!
  const resumed = setup({
    mode: 'openai',
    async next() {
      throw new Error('A duplicate message must never invoke the provider')
    },
  })
  await resumed.connection.receive({
    type: 'session.open',
    authToken: first.token,
    conversationId,
    sessionId: oldTransport.snapshot.sessionId,
    token: oldTransport.token,
  })
  assert.equal(resumed.events[0]!.type, 'session.ready')
  if (resumed.events[0]!.type === 'session.ready') {
    assert.equal(resumed.events[0]!.restored, true)
    assert.notEqual(
      resumed.events[0]!.snapshot.sessionId,
      oldTransport.snapshot.sessionId,
    )
    assert.equal(resumed.events[0]!.snapshot.conversationId, conversationId)
    assert.equal(resumed.events[0]!.snapshot.messages[0]!.content, '看看附件')
    assert.deepEqual(resumed.events[0]!.snapshot.messages[0]!.applicationIds, [
      'ledger',
    ])
  }
  await resumed.connection.receive(request)
  assert.equal(resumed.events.at(-1)!.type, 'session.snapshot')
  await resumed.connection.receive({ ...request, applicationIds: [] })
  assert.equal((resumed.events.at(-1) as any).code, 'REQUEST_ID_CONFLICT')
  await assert.rejects(p.conversations.load(other, conversationId), /不存在/)
  assert.equal((await p.conversations.list(actor)).length, 2)
  await p.conversations.remove(actor, conversationId)
  await resumed.connection.receive({ ...request, requestId: randomUUID() })
  assert.equal((resumed.events.at(-1) as any).code, 'CONVERSATION_NOT_FOUND')
  await assert.rejects(p.conversations.load(actor, conversationId), /不存在/)
  const book = await p.ledgers.create(actor, {
    name: '受保护的账本',
    template: 'daily',
    password: 'book123',
  })
  const category = (await p.finance.categories(actor, book.id)).find(
    (c) => c.type === 'expense',
  )!
  const billArgs = {
    type: 'expense',
    amount: '12.00',
    category: category.id,
    date: '2026-10-05',
    note: '工具测试',
  }
  await p.ledgers.lock(actor, book.id)
  for (const authorize of [false, true]) {
    let index = 0
    const seen: string[] = []
    const write = setup({
      mode: 'openai',
      async next(input) {
        seen.push(JSON.stringify(input.history))
        return (
          [
            step('skill_activate', { skillId: 'bookkeeping' }),
            step('bills_create', billArgs),
          ][index++] || done
        )
      },
    })
    await write.connection.receive({
      type: 'session.open',
      authToken: first.token,
    })
    await write.connection.receive({
      type: 'message.send',
      requestId: randomUUID(),
      text: '记录测试支出',
      localDate: '2026-10-05',
      ledgerId: book.id,
    })
    await until(() => write.events.some((e) => e.type === 'tool.request'))
    const pending = write.events.find((e) => e.type === 'tool.request')!
    assert.equal(pending.name, 'application_authorize')
    assert.equal((pending.arguments as any).scope, 'write')
    const snapshot = [...write.events].reverse().find((e) => e.type === 'session.snapshot')
    assert.ok(snapshot, 'The session must be opened before testing deletion during a write')
    assert.ok(snapshot.snapshot.conversationId)
    await assert.rejects(
      p.conversations.remove(
        actor,
        snapshot.snapshot.conversationId,
      ),
      /正在执行/,
    )
    if (authorize) {
      await assert.rejects(
        p.ledgers.unlock(actor, book.id, {
          password: 'wrong12',
          scope: 'write',
        }),
        /密码/,
      )
      await p.ledgers.unlock(actor, book.id, {
        password: 'book123',
        scope: 'write',
      })
      const [grant] = await source.query(
        'SELECT scope,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(3),expires_at) AS remaining FROM ledger_unlocks WHERE ledger_id=? AND session_hash=?',
        [book.id, actor.sessionHash],
      )
      assert.equal(grant.scope, 'write')
      assert.ok(grant.remaining > 580 && grant.remaining <= 600)
    }
    // A true browser ACK alone cannot grant access. Only the REST password endpoint can.
    await write.connection.receive({
      type: 'tool.result',
      runId: pending.runId,
      callId: pending.callId,
      result: {
        ok: true,
        data: { authorized: true, password: 'injected-secret' },
      },
    })
    await until(() => write.events.some((e) => e.type === 'run.finished'))
    const result = write.events.find((e) => e.type === 'run.finished')!
    assert.equal(
      result.snapshot.messages
        .at(-1)!
        .toolCalls
        .find((t) => t.name === 'bills_create')!.status,
      authorize ? 'completed' : 'failed',
    )
    assert.ok(
      seen.every(
        (s) => !s.includes('book123') && !s.includes('injected-secret'),
      ),
    )
    if (authorize) {
      assert.equal((await p.finance.bills(actor, book.id, {})).meta.total, 1)
      const id = result.snapshot.conversationId!
      await source.query(
        'UPDATE ledger_unlocks SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE ledger_id=?',
        [book.id],
      )
      await assert.rejects(p.conversations.load(actor, id), {
        code: 'RESOURCE_LOCKED',
        statusCode: 423,
      })
      const summary = (await p.conversations.list(actor)).find(
        (c) => c.id === id,
      )!
      assert.equal(summary.title, '受保护的会话')
      assert.deepEqual(summary.protectedResources, [
        { appId: 'ledger', resourceType: 'book', resourceId: book.id },
      ])
      const roundsBefore = seen.length
      await write.connection.receive({
        type: 'message.send',
        requestId: randomUUID(),
        text: '继续聊天',
        localDate: '2026-10-05',
        ledgerId: book.id,
      })
      await until(
        () =>
          write.events.filter((e) => e.type === 'tool.request').length === 2,
      )
      assert.equal(seen.length, roundsBefore, '过期财务历史不可进入模型')
      const historyAuth = write.events
        .filter((e) => e.type === 'tool.request')
        .at(-1)!
      await write.connection.receive({
        type: 'tool.result',
        runId: historyAuth.runId,
        callId: historyAuth.callId,
        result: { ok: true, data: { authorized: true } },
      })
      await until(
        () =>
          write.events.filter((e) => e.type === 'run.finished').length === 2,
      )
      assert.equal(seen.length, roundsBefore, '伪造历史授权回执不能泄漏历史')
      await p.ledgers.unlock(actor, book.id, {
        password: 'book123',
        scope: 'read',
      })
      await p.access.check(actor, book.id)
      await assert.rejects(p.access.check(actor, book.id, 'write'), /解锁/)
      await p.conversations.load(actor, id)
      await source.query(
        'DELETE FROM ledger_members WHERE ledger_id=? AND user_id=?',
        [book.id, actor.user.id],
      )
      await assert.rejects(p.conversations.load(actor, id), /成员/)
      await source.query(
        'INSERT INTO ledger_members(ledger_id,user_id,role) VALUES(?,?,\'owner\')',
        [book.id, actor.user.id],
      )
    }
    write.connection.close()
    await write.service.close()
  }
  await p.resources.remove(actor, image.id)
  await assert.rejects(p.resources.get(actor, image.id), /不存在/)
  assert.equal(
    (await p.resources.list(actor, { source: 'generated' })).meta.total,
    3,
  )
  console.log(
    'PASS: private uploads/downloads, MIME/quota boundaries, local Image API generate/edit, attachment model input, durable history/dedup/deletion, scoped 10-minute grants, forged ACK, password isolation and history ACL.',
  )
} finally {
  for (const service of services) {
    await service.close()
  }
  await app.close()
  await cleanupUsers(source, users)
  await source.destroy()
  remote.closeAllConnections()
  await new Promise<void>((r) => remote.close(() => r()))
}
