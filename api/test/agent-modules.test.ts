import type { ChatServerEvent, Resource, ResourceRef } from '@t-box/shared'
import type { Actor, ApplicationModule } from '../src/agent/contracts.js'
import type { ChatProvider } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import { ApiError } from '@t-box/server-foundation/errors'
import { createShellModule } from '../src/agent/builtins.js'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { definition, object } from '../src/agent/schema.js'
import { createCapabilities } from '../src/bootstrap/chat.js'
import { ChatService } from '../src/chat/engine.js'
import { MemorySessionRepository } from '../src/chat/session.js'

const actor: Actor = {
  user: {
    id: randomUUID(),
    username: 'fixture',
    nickname: '测试',
    createdAt: new Date().toISOString(),
  },
  sessionHash: 'fixture',
}
const ref: ResourceRef = {
  appId: 'notes',
  resourceType: 'notebook',
  resourceId: 'private-notes',
}
const asset: Resource = {
  id: randomUUID(),
  name: 'result.txt',
  mimeType: 'text/plain',
  size: 10,
  source: 'generated',
  createdAt: new Date().toISOString(),
}
const wait = async (check: () => boolean) => {
  const end = Date.now() + 1500
  while (!check()) {
    if (Date.now() > end) {
      throw new Error('Missing module event')
    }
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}
function fixture() {
  let unlocked = false
  let writes = 0
  const module: ApplicationModule = {
    id: 'notes',
    manifest: {
      id: 'notes',
      name: '笔记',
      description: '测试独立应用',
      icon: 'file',
      color: 'blue',
      version: '1.0.0',
      skillIds: ['note_taking'],
    },
    skills: {
      note_taking: {
        title: '笔记整理',
        description: '测试笔记能力',
        version: '1.0.0',
        tools: ['notes_save'],
        instructions: '只在用户要求保存笔记时写入。',
      },
    },
    access: {
      appId: 'notes',
      async inspect(_actor, resource, action, purpose) {
        if (
          resource.resourceType !== 'notebook' ||
          resource.resourceId !== ref.resourceId
        ) {
          throw new ApiError(403, 'RESOURCE_DENIED', '无权访问此笔记本')
        }
        return unlocked
          ? {}
          : {
              challenge: {
                name: 'notes_unlock',
                arguments: { resource, purpose, action },
              },
            }
      },
    },
    navigation: {
      properties: { noteId: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      parse(value): Record<string, string> {
        const args = object(value, ['noteId'])
        if (args.noteId != null && typeof args.noteId !== 'string') {
          throw new ApiError(400, 'INVALID_ARGUMENTS', '笔记标识无效')
        }
        return args.noteId ? { noteId: args.noteId as string } : {}
      },
    },
    tools: {
      notes_save: {
        definition: definition('notes_save', '保存笔记', {
          text: { type: 'string' },
        }),
        title: '保存笔记',
        execution: 'server',
        effect: 'write',
        successSummary: '笔记已保存',
        resources: () => [{ resource: ref, action: 'write' }],
        writeFingerprint: (value) => JSON.stringify(value),
        confirm: async () => ({
          name: 'notes_confirm',
          arguments: { title: '保存笔记' },
          timeoutMs: 1000,
        }),
        handler: async (value) => {
          object(value, ['text'])
          writes++
          return { id: 'note-one', resources: [asset] }
        },
        attachments: (data) => (data as { resources: Resource[] }).resources,
      },
    },
  }
  return {
    module,
    get writes() {
      return writes
    },
    unlock() {
      unlocked = true
    },
    lock() {
      unlocked = false
    },
  }
}
function setup(
  t: test.TestContext,
  features: ReturnType<typeof fixture>,
  provider: ChatProvider,
  capabilities = ['notes_unlock', 'notes_confirm', 'app_open'],
) {
  const modules = [features.module]
  const registry = new CapabilityRegistry([
    ...modules,
    createShellModule(modules),
  ])
  const events: ChatServerEvent[] = []
  const runtime = new ChatService({
    registry,
    provider,
    host: {
      identity: {
        authenticate: async () => actor,
        authenticateHash: async () => actor,
      },
    },
    clientToolTimeoutMs: 500,
  })
  const connection = runtime.connect((event) => events.push(event))
  t.after(async () => {
    connection.close()
    await runtime.close()
  })
  return { registry, runtime, events, connection, capabilities }
}
const request = (events: ChatServerEvent[], name: string) =>
  events.findLast(
    (event) => event.type === 'tool.request' && event.name === name,
  ) as Extract<ChatServerEvent, { type: 'tool.request' }>
const ack = async (
  connection: ReturnType<ChatService['connect']>,
  event: ReturnType<typeof request>,
  data: unknown,
) =>
  connection.receive({
    type: 'tool.result',
    runId: event.runId,
    callId: event.callId,
    result: { ok: true, data },
  })
function scripted(): ChatProvider {
  let round = 0
  return {
    mode: 'openai',
    async next(input) {
      assert.ok(input.tools.some((tool) => tool.name === 'notes_save'))
      assert.ok(!input.tools.some((tool) => tool.name === 'bills_create'))
      assert.match(input.instructions, /笔记整理/)
      const calls =
        round < 2
          ? [
              {
                id: `save-${round}`,
                name: 'notes_save',
                arguments: '{"text":"明确保存"}',
              },
            ]
          : round === 2
            ? [
                {
                  id: 'open-notes',
                  name: 'app_open',
                  arguments: '{"appId":"notes","params":{"noteId":"note-one"}}',
                },
              ]
            : []
      round++
      return {
        calls,
        output: calls.map((call) => ({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        })),
      }
    },
  }
}
test('an independent module supports permission challenge → confirmation → deduplicated write → client navigation and resource provenance', async (t) => {
  const features = fixture()
  const { connection, events, runtime, capabilities } = setup(
    t,
    features,
    scripted(),
  )
  await connection.receive({
    type: 'session.open',
    authToken: 'fixture',
    clientCapabilities: capabilities,
  })
  await connection.receive({
    type: 'message.send',
    requestId: 'note-request',
    text: '保存这篇笔记',
    localDate: '2026-10-06',
    applicationIds: ['notes'],
    scopeBindings: [ref],
  })
  await wait(() => !!request(events, 'notes_unlock'))
  features.unlock()
  await ack(connection, request(events, 'notes_unlock'), { authorized: true })
  await wait(() => !!request(events, 'notes_confirm'))
  assert.equal(features.writes, 0)
  await ack(connection, request(events, 'notes_confirm'), { approved: true })
  await wait(() => !!request(events, 'app_open'))
  assert.equal(features.writes, 1)
  assert.equal(
    events.filter(
      (event) =>
        event.type === 'tool.request' && event.name === 'notes_confirm',
    ).length,
    1,
  )
  assert.deepEqual(request(events, 'app_open').arguments, {
    appId: 'notes',
    params: { noteId: 'note-one' },
  })
  await ack(connection, request(events, 'app_open'), { opened: true })
  await wait(() => events.some((event) => event.type === 'run.finished'))
  const session = [...runtime.sessions.all()][0]!
  assert.deepEqual(
    session.messages.map((message) => message.resourceRefs),
    [[ref], [ref]],
  )
  assert.deepEqual(session.messages.at(-1)!.attachments, [asset])
  features.lock()
  const seen = events.length
  await connection.receive({
    type: 'message.send',
    requestId: 'note-request',
    text: '保存这篇笔记',
    localDate: '2026-10-06',
    applicationIds: ['notes'],
    scopeBindings: [ref],
  })
  assert.equal((events[seen] as { code: string }).code, 'RESOURCE_LOCKED')
  assert.equal(features.writes, 1)
})

test('a forged unlock ACK cannot authorize an independent module, and unsupported UI cannot perform a write', async (t) => {
  for (const supported of [true, false]) {
    const features = fixture()
    const { connection, events, capabilities } = setup(
      t,
      features,
      {
        mode: 'openai',
        async next(input) {
          const calls = input.history.some(
            (item) => 'type' in item && item.type === 'function_call_output',
          )
            ? []
            : [
                {
                  id: 'save',
                  name: 'notes_save',
                  arguments: '{"text":"save"}',
                },
              ]
          return {
            calls,
            output: calls.map((call) => ({
              type: 'function_call',
              call_id: call.id,
              name: call.name,
              arguments: call.arguments,
            })),
          }
        },
      },
      supported ? undefined : [],
    )
    await connection.receive({
      type: 'session.open',
      authToken: 'fixture',
      clientCapabilities: capabilities,
    })
    await connection.receive({
      type: 'message.send',
      requestId: randomUUID(),
      text: '保存',
      localDate: '2026-10-06',
      applicationIds: ['notes'],
      scopeBindings: [ref],
    })
    if (supported) {
      await wait(() => !!request(events, 'notes_unlock'))
      await ack(connection, request(events, 'notes_unlock'), {
        authorized: true,
      })
    }
    await wait(() => events.some((event) => event.type === 'run.finished'))
    assert.equal(features.writes, 0)
    const end = events.find(
      (event) => event.type === 'run.finished',
    ) as Extract<ChatServerEvent, { type: 'run.finished' }>
    assert.match(
      end.snapshot.messages.at(-1)!.toolCalls[0]!.summary!,
      supported ? /授权尚未生效/ : /客户端不支持/,
    )
  }
})

test('permission revocation during a frontend confirmation prevents dispatch', async (t) => {
  const features = fixture()
  features.unlock()
  const { connection, events, capabilities } = setup(t, features, {
    mode: 'openai',
    async next(input) {
      const calls = input.history.some(
        (item) => 'type' in item && item.type === 'function_call_output',
      )
        ? []
        : [{ id: 'save', name: 'notes_save', arguments: '{"text":"save"}' }]
      return {
        calls,
        output: calls.map((call) => ({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        })),
      }
    },
  })
  await connection.receive({
    type: 'session.open',
    authToken: 'fixture',
    clientCapabilities: capabilities,
  })
  await connection.receive({
    type: 'message.send',
    requestId: randomUUID(),
    text: '保存',
    localDate: '2026-10-06',
    applicationIds: ['notes'],
    scopeBindings: [ref],
  })
  await wait(() => !!request(events, 'notes_confirm'))
  features.lock()
  await ack(connection, request(events, 'notes_confirm'), { approved: true })
  await wait(() => events.some((event) => event.type === 'run.finished'))
  assert.equal(features.writes, 0)
})

test('registration rejects conflicting names, missing handlers, unknown skill tools and non-idempotent effects', () => {
  const { module } = fixture()
  assert.throws(
    () => new CapabilityRegistry([module, module]),
    /Duplicate module/,
  )
  assert.throws(
    () =>
      new CapabilityRegistry([
        { ...module, id: 'other', manifest: undefined },
        module,
      ]),
    /Duplicate skill/,
  )
  assert.throws(
    () => new CapabilityRegistry([{ ...module, tools: {} }]),
    /Unknown tool/,
  )
  const tool = module.tools.notes_save!
  assert.throws(
    () =>
      new CapabilityRegistry([
        { ...module, tools: { notes_save: { ...tool, handler: undefined } } },
      ]),
    /Missing handler/,
  )
  assert.throws(
    () =>
      new CapabilityRegistry([
        {
          ...module,
          tools: { notes_save: { ...tool, writeFingerprint: undefined } },
        },
      ]),
    /Missing write fingerprint/,
  )
})

test('ledger migration retains old requests/history as generic resource references without dropping unrelated resources', () => {
  const registry = createCapabilities({ bills: {} as any })
  const session = new MemorySessionRepository().create()
  const book = randomUUID()
  Object.assign(session, { ledgerId: book })
  session.messages = [
    {
      id: 'old',
      role: 'user',
      content: '旧记录',
      createdAt: new Date().toISOString(),
      toolCalls: [],
      ledgerId: book,
      resourceRefs: [ref],
    } as any,
  ]
  session.requests.set('old', {
    text: '旧记录',
    localDate: '2026-10-06',
    ledgerId: book,
  } as any)
  registry.migrateSession(session)
  registry.migrateSession(session)
  const bookRef = { appId: 'ledger', resourceType: 'book', resourceId: book }
  assert.deepEqual(session.scopeBindings, [bookRef])
  assert.deepEqual(session.messages[0]!.resourceRefs, [ref, bookRef])
  assert.deepEqual(session.requests.get('old')!.scopeBindings, [bookRef])
  assert.equal('ledgerId' in session, false)
  assert.equal('ledgerId' in session.messages[0]!, false)
  assert.deepEqual(
    registry.decodeEvent({
      type: 'message.send',
      ledgerId: book,
      scopeBindings: [ref],
    }),
    { type: 'message.send', scopeBindings: [ref, bookRef] },
  )
})

test('runtime and transport modules cannot import application domain implementations', async () => {
  for (const folder of ['agent', 'chat']) {
    for (const name of await readdir(
      new URL(`../src/${folder}/`, import.meta.url),
    )) {
      if (!name.endsWith('.ts')) {
        continue
      }
      const source = await readFile(
        new URL(`../src/${folder}/${name}`, import.meta.url),
        'utf8',
      )
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
        (match) => match[1]!,
      )
      assert.ok(
        imports
          .filter((path) => path.startsWith('.'))
          .every(
            (path) =>
              !/(?:applications|ledgers|finance|statistics|platform|categories|repository|resources)\//.test(
                path,
              ) && !path.endsWith('/repository.js'),
          ),
        `${folder}/${name} imports a domain implementation`,
      )
    }
  }
})

test('truthy non-boolean confirmation data never authorizes a write', async (t) => {
  const features = fixture()
  features.unlock()
  const { connection, events, capabilities } = setup(t, features, scripted())
  await connection.receive({
    type: 'session.open',
    authToken: 'fixture',
    clientCapabilities: capabilities,
  })
  await connection.receive({
    type: 'message.send',
    requestId: 'bad-confirmation',
    text: '保存笔记',
    localDate: '2026-10-06',
    applicationIds: ['notes'],
    scopeBindings: [ref],
  })
  await wait(() => !!request(events, 'notes_confirm'))
  await ack(connection, request(events, 'notes_confirm'), {
    approved: 'false',
  })
  await wait(() => !!request(events, 'app_open'))
  assert.equal(features.writes, 0)
  await ack(connection, request(events, 'app_open'), { opened: true })
  await wait(() => events.some((event) => event.type === 'run.finished'))
  const end = events.find((event) => event.type === 'run.finished') as Extract<
    ChatServerEvent,
    { type: 'run.finished' }
  >
  assert.equal(end.snapshot.messages.at(-1)!.toolCalls[0]!.status, 'failed')
})

test('cancellation during permission lookup cannot dispatch a new side effect', async (t) => {
  const features = fixture()
  features.unlock()
  let inspected = false
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const inspect = features.module.access!.inspect
  features.module.access!.inspect = async (...args) => {
    if (args[2] === 'write') {
      inspected = true
      await gate
    }
    return inspect(...args)
  }
  delete features.module.tools.notes_save!.confirm
  const { connection, events, capabilities } = setup(t, features, scripted())
  await connection.receive({
    type: 'session.open',
    authToken: 'fixture',
    clientCapabilities: capabilities,
  })
  await connection.receive({
    type: 'message.send',
    requestId: 'cancel-during-access',
    text: '保存笔记',
    localDate: '2026-10-06',
    applicationIds: ['notes'],
    scopeBindings: [ref],
  })
  await wait(() => inspected)
  const started = events.find(
    (event) => event.type === 'run.started',
  ) as Extract<ChatServerEvent, { type: 'run.started' }>
  await connection.receive({ type: 'run.cancel', runId: started.run.id })
  release()
  await wait(() => events.some((event) => event.type === 'run.finished'))
  assert.equal(features.writes, 0)
})

test('concurrent handshakes cannot allocate two sessions and disconnect during authentication does not retain ownership', async (t) => {
  const features = fixture()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const modules = [features.module]
  const registry = new CapabilityRegistry([
    ...modules,
    createShellModule(modules),
  ])
  const runtime = new ChatService({
    registry,
    provider: scripted(),
    host: {
      identity: {
        authenticate: async () => {
          await gate
          return actor
        },
        authenticateHash: async () => actor,
      },
    },
  })
  const events: ChatServerEvent[] = []
  const connection = runtime.connect((event) => events.push(event))
  t.after(async () => {
    connection.close()
    await runtime.close()
  })
  const opening = connection.receive({
    type: 'session.open',
    authToken: 'fixture',
  })
  await connection.receive({ type: 'session.open', authToken: 'fixture' })
  assert.equal((events[0] as { code: string }).code, 'SESSION_ALREADY_OPEN')
  connection.close()
  release()
  await opening
  assert.equal([...runtime.sessions.all()].length, 0)
  assert.ok(!events.some((event) => event.type === 'session.ready'))
})

test('final archive and authorization keep the run lock until the finished snapshot is ready', async (t) => {
  const features = fixture()
  let saving = false
  let release!: () => void
  let calls = 0
  let archiveReleased = false
  let checkingFinal = false
  let releaseAuthorization!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const authorizationGate = new Promise<void>((resolve) => {
    releaseAuthorization = resolve
  })
  const modules = [features.module]
  const registry = new CapabilityRegistry([
    ...modules,
    createShellModule(modules),
  ])
  const runtime = new ChatService({
    registry,
    provider: {
      mode: 'openai',
      async next() {
        calls++
        return { output: [], calls: [] }
      },
    },
    host: {
      identity: {
        authenticate: async () => actor,
        authenticateHash: async () => {
          if (archiveReleased && !checkingFinal) {
            checkingFinal = true
            await authorizationGate
          }
          return actor
        },
      },
      conversations: {
        save: async (session) => {
          if (!session.active) {
            saving = true
            await gate
          }
        },
        load: async () => {},
        restore: async () => {},
        exists: async () => true,
      },
    },
  })
  const events: ChatServerEvent[] = []
  const connection = runtime.connect((event) => events.push(event))
  t.after(async () => {
    release()
    releaseAuthorization()
    connection.close()
    await runtime.close()
  })
  await connection.receive({ type: 'session.open', authToken: 'fixture' })
  await connection.receive({
    type: 'message.send',
    requestId: 'first',
    text: '你好',
    localDate: '2026-10-06',
  })
  await wait(() => saving)
  await connection.receive({
    type: 'message.send',
    requestId: 'second',
    text: '下一条',
    localDate: '2026-10-06',
  })
  assert.equal((events.at(-1) as { code: string }).code, 'RUN_IN_PROGRESS')
  assert.equal(calls, 1)
  assert.equal([...runtime.sessions.all()][0]!.requests.has('second'), false)
  archiveReleased = true
  release()
  await wait(() => checkingFinal)
  await connection.receive({
    type: 'message.send',
    requestId: 'third',
    text: '授权检查期间的下一条',
    localDate: '2026-10-06',
  })
  assert.equal((events.at(-1) as { code: string }).code, 'RUN_IN_PROGRESS')
  assert.equal(calls, 1)
  assert.equal([...runtime.sessions.all()][0]!.requests.has('third'), false)
  releaseAuthorization()
  await wait(() => events.some((event) => event.type === 'run.finished'))
  assert.equal([...runtime.sessions.all()][0]!.finishing, false)
})

test('an expired resource grant redacts WS snapshots without altering durable history, and a fresh grant restores visibility', async () => {
  const { authorizedSnapshot } = await import('../src/agent/snapshot.js')
  const features = fixture()
  const registry = new CapabilityRegistry([
    features.module,
    createShellModule([features.module]),
  ])
  const session = new MemorySessionRepository().create()
  session.messages = [
    {
      id: 'private-message',
      role: 'assistant',
      content: 'private note content',
      timeline: [
        {
          id: 'private-text',
          sequence: 1,
          revision: 1,
          createdAt: 'now',
          kind: 'analysis',
          text: 'private note timeline',
          status: 'completed',
        },
      ],
      createdAt: new Date().toISOString(),
      toolCalls: [
        {
          id: 'private-call',
          name: 'notes_save',
          title: '保存笔记',
          execution: 'server',
          status: 'completed',
          summary: 'private note summary',
        },
      ],
      resourceRefs: [ref],
      attachments: [asset],
    },
  ]
  const options = { registry, provider: scripted() }
  const redacted = await authorizedSnapshot(options, session, 'openai', actor)
  assert.ok(!JSON.stringify(redacted).includes('private note'))
  assert.deepEqual(redacted.messages[0]!.toolCalls, [])
  assert.deepEqual(redacted.messages[0]!.timeline, [])
  assert.deepEqual(redacted.messages[0]!.attachments, [])
  assert.deepEqual(redacted.messages[0]!.resourceRefs, [ref])
  assert.equal(session.messages[0]!.content, 'private note content')
  features.unlock()
  assert.equal(
    (await authorizedSnapshot(options, session, 'openai', actor)).messages[0]!
      .content,
    'private note content',
  )
})
