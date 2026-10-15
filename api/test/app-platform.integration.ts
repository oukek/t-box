import type { AppRelease, LifecycleReceipt } from '@t-box/app-contracts'
import type { ApplicationBackend } from '@t-box/app-server-sdk'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import {
  createApplicationBackendHandler,
} from '@t-box/app-server-sdk'
import { executeTool } from '../src/agent/executor.js'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { createApp } from '../src/app.js'
import { RemoteApplicationBackend } from '../src/application-platform/adapters/remote.js'
import { remoteApplicationModule } from '../src/application-platform/adapters/tools.js'
import { bindInstalledCapabilities } from '../src/application-platform/capabilities.js'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { definition } from '../src/application-sdk/schema.js'
import { adaptApplication } from '../src/bootstrap/application-adapter.js'
import { createCapabilities } from '../src/bootstrap/chat.js'
import { MemorySessionRepository } from '../src/chat/session.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const app = createApp({
  platform,
  bills: {} as any,
  health: async () => ({ mysql: 'up', redis: 'disabled' }),
})
const users: string[] = []
const id = 'test_' + randomUUID().replaceAll('-', '').slice(0, 20)
let applied = 0
let statusChecks = 0
let dropReply = false
const receipts = new Map<string, LifecycleReceipt>()
const backend: ApplicationBackend = {
  async lifecycle(r) {
    if (receipts.has(r.operationId)) {
      return receipts.get(r.operationId)!
    }
    applied++
    const result: LifecycleReceipt = {
      status: 'completed',
      receipt: { generation: r.generation, action: r.action },
    }
    receipts.set(r.operationId, result)
    return result
  },
  async operation(r) {
    statusChecks++
    return receipts.get(r.operationId) || null
  },
  async invoke(r) {
    return { subject: r.subject, generation: r.generation, value: r.arguments }
  },
  async prepare(r) {
    assert.equal(r.invocation.appId, id)
    assert.notEqual(r.invocation.subject.length, 0)
    assert.equal('actor' in r, false)
    return { status: 'ready', ticket: 'fixture-bound-preparation' }
  },
  async events(r) {
    assert.equal(r.channel, 'changed')
    return { cursor: 'event-cursor-1', events: [{ type: 'changed', generation: r.generation, cursor: r.cursor || null }] }
  },
}
const handler = createApplicationBackendHandler({
  appId: id,
  credential: 'fixture-service-credential',
  backend,
})
const server = createServer(async (req, res) => {
  const parts: Buffer[] = []
  for await (const part of req) {
    parts.push(Buffer.from(part))
  }
  const url = `http://127.0.0.1${req.url}`
  const response = await handler(
    new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: Buffer.concat(parts),
    }),
  )
  if (dropReply && req.url === '/lifecycle/ensure') {
    dropReply = false
    res.destroy()
    return
  }
  res.writeHead(response.status, { 'Content-Type': 'application/json' })
  res.end(await response.text())
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const remote = new RemoteApplicationBackend(
  `http://127.0.0.1:${port}/`,
  'fixture-service-credential',
  1000,
)
const release: AppRelease = {
  appId: id,
  releaseId: `${id}-1`,
  manifest: {
    id,
    name: '测试远程应用',
    description: 'fixture',
    version: '1.0.0',
    icon: 'apps',
    color: 'blue',
    skillIds: [],
  },
  protocol: 1,
  kind: 'user',
  platforms: ['web', 'android', 'ios'],
  runtime: {
    type: 'web',
    entryUrl: 'https://fixture.example/',
    integrity: 'sha256-' + 'a'.repeat(64),
  },
  backend: { type: 'remote', binding: id },
  permissions: [`${id}.echo`, 'events.changed'],
  clientTools: [],
  defaultInstalled: false,
}
const catalog = new ApplicationPlatform(source, [release])
catalog.bind(id, remote)
try {
  const registration = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      username: 'test_platform_' + randomUUID().replaceAll('-', ''),
      password: 'test123',
      nickname: '应用测试',
    },
  })
  assert.equal(registration.statusCode, 201)
  const session = registration.json().data
  users.push(session.user.id)
  const user = session.user.id
  await platform.applications.bootstrap(user)
  const book = await app.inject({
    method: 'POST',
    url: '/api/v1/ledgers',
    headers: { authorization: `Bearer ${session.token}` },
    payload: { name: '卸载保留测试', template: 'daily' },
  })
  assert.equal(book.statusCode, 201, book.body)
  const savedBookId = book.json().data.id
  const old = (await platform.applications.assertActive(user, 'ledger'))
    .installation
  const shellContext = await app.inject({
    method: 'GET',
    url: '/api/v1/applications/ledger/context?platform=web',
    headers: { authorization: `Bearer ${session.token}` },
  })
  assert.equal(shellContext.statusCode, 200, shellContext.body)
  assert.equal(shellContext.json().data.runtime, 'web')
  assert.ok(shellContext.json().data.capabilities.includes('api.request'))
  assert.equal(
    shellContext.json().data.subject,
    platform.applications.subject(user, 'ledger'),
  )
  assert.equal(shellContext.json().data.generation, old.generation)
  assert.equal('token' in shellContext.json().data, false)
  assert.equal(shellContext.body.includes(session.token), false)
  const anonymousContext = await app.inject({
    method: 'GET',
    url: '/api/v1/applications/ledger/context?platform=web',
  })
  assert.equal(anonymousContext.statusCode, 401)
  const invalidPlatform = await app.inject({
    method: 'GET',
    url: '/api/v1/applications/ledger/context?platform=desktop',
    headers: { authorization: `Bearer ${session.token}` },
  })
  assert.equal(invalidPlatform.statusCode, 400)
  const webContext = await app.inject({
    method: 'GET',
    url: '/api/v1/applications/calculator/context?platform=ios',
    headers: { authorization: `Bearer ${session.token}` },
  })
  assert.equal(webContext.statusCode, 200)
  assert.equal(webContext.json().data.runtime, 'web')
  assert.equal(
    webContext.json().data.capabilities.includes('api.invoke'),
    true,
  )
  assert.equal(
    webContext.json().data.capabilities.includes('storage.remove'),
    true,
  )
  const firstKey = randomUUID()
  const removed = await platform.applications.change(
    user,
    'ledger',
    'uninstall',
    old.releaseId,
    firstKey,
    [],
  )
  assert.equal(removed.status, 'completed')
  const removedContext = await app.inject({
    method: 'GET',
    url: '/api/v1/applications/ledger/context?platform=web',
    headers: { authorization: `Bearer ${session.token}` },
  })
  assert.equal(removedContext.statusCode, 403)
  assert.equal(removedContext.json().error.code, 'APP_NOT_INSTALLED')
  const blockedBook = await app.inject({
    method: 'GET',
    url: `/api/v1/ledgers/${savedBookId}`,
    headers: { authorization: `Bearer ${session.token}` },
  })
  assert.equal(blockedBook.statusCode, 403)
  assert.equal(
    (
      await platform.applications.change(
        user,
        'ledger',
        'uninstall',
        old.releaseId,
        firstKey,
        [],
      )
    ).id,
    removed.id,
  )
  await assert.rejects(
    platform.applications.change(
      user,
      'ledger',
      'install',
      old.releaseId,
      firstKey,
      [],
    ),
    /操作标识/,
  )
  await assert.rejects(
    platform.applications.assertActive(user, 'ledger'),
    /安装/,
  )
  assert.ok(
    !(await platform.applications.installed(user)).some(
      (e) => e.release.appId === 'ledger',
    ),
  )
  const registry = createCapabilities({ platform, bills: {} as any })
  const context = {
    actor: { user: session.user, sessionHash: '' },
    skills: new Set(['bookkeeping']),
    modulePins: {},
  } as any
  assert.ok(
    !(await registry.availableTools(context)).some((t) =>
      ['bills_list', 'bills_create'].includes(t.name),
    ),
  )
  await assert.rejects(registry.requireTool('bills_list', {}, context), /安装/)
  await assert.rejects(
    registry.requireTool('skill_activate', { skillId: 'bookkeeping' }, context),
    /安装/,
  )
  await assert.rejects(
    platform.applications.change(
      user,
      'profile',
      'uninstall',
      'profile-1.0.0',
      randomUUID(),
      [],
    ),
    /系统应用/,
  )
  const restored = await platform.applications.change(
    user,
    'ledger',
    'install',
    old.releaseId,
    randomUUID(),
    (await platform.applications.release(old.releaseId)).permissions,
  )
  assert.equal(restored.status, 'completed')
  const restoredBook = await app.inject({
    method: 'GET',
    url: `/api/v1/ledgers/${savedBookId}`,
    headers: { authorization: `Bearer ${session.token}` },
  })
  assert.equal(restoredBook.statusCode, 200)
  assert.equal(restoredBook.json().data.name, '卸载保留测试')
  const current = (await platform.applications.assertActive(user, 'ledger'))
    .installation
  assert.equal(current.generation, old.generation + 1)
  await assert.rejects(
    platform.applications.invoke(
      user,
      'ledger',
      old.releaseId,
      old.generation,
      'calculate',
      {},
      randomUUID(),
    ),
    /重新打开/,
  )
  await registry.requireTool('bills_list', {}, context)
  assert.ok(context.modulePins.ledger)
  await assert.rejects(
    platform.applications.change(
      user,
      'calculator',
      'uninstall',
      (await platform.applications.assertActive(user, 'calculator')).release
        .releaseId,
      randomUUID(),
      [],
    ),
    /系统应用/,
  )
  await catalog.initialize()
  const key = randomUUID()
  dropReply = true
  const pending = await catalog.change(
    user,
    id,
    'install',
    release.releaseId,
    key,
    release.permissions,
  )
  assert.equal(pending.status, 'pending')
  assert.equal(applied, 1)
  await assert.rejects(catalog.assertActive(user, id), /安装/)
  // Reconstruct the worker (server restart) and reconcile the exact operation id, without a second side effect.
  const recovered = new ApplicationPlatform(source, [release])
  recovered.bind(id, remote)
  await source.query(
    'UPDATE application_lifecycle_operations SET next_attempt_at=UTC_TIMESTAMP(3) WHERE id=?',
    [pending.id],
  )
  await recovered.recover()
  assert.equal(
    (await recovered.operation(user, pending.id)).status,
    'completed',
  )
  assert.equal(applied, 1)
  assert.equal(statusChecks, 1)
  const active = await recovered.assertActive(user, id)
  const answer = (await recovered.invoke(
    user,
    id,
    release.releaseId,
    active.installation.generation,
    'echo',
    { hello: true },
    randomUUID(),
  )) as any
  assert.deepEqual(answer.value, { hello: true })
  assert.notEqual(answer.subject, user)
  assert.equal(answer.subject.length, 64)
  const batch = await recovered.events(user, id, { releaseId: release.releaseId, generation: active.installation.generation, channel: 'changed' })
  assert.equal(batch.cursor, 'event-cursor-1')
  assert.equal(batch.events.length, 1)
  await assert.rejects(recovered.events(user, id, { releaseId: release.releaseId, generation: active.installation.generation, channel: 'private' }), /权限/)
  const remoteModule = remoteApplicationModule(
    {
      id,
      contractVersion: '1.0',
      manifest: release.manifest,
      skills: {},
      tools: {
        [`${id}_echo`]: {
          title: '远程回显',
          definition: definition(`${id}_echo`, 'remote fixture', {
            text: { type: 'string' },
          }),
          execution: 'server',
          effect: 'read',
          alwaysAvailable: true,
          successSummary: '完成',
        },
      },
    },
    { [`${id}_echo`]: 'echo' },
    recovered,
    { preparation: true },
  )
  const remoteRegistry = new CapabilityRegistry([
    bindInstalledCapabilities(adaptApplication(remoteModule), recovered),
  ])
  const chatSession = new MemorySessionRepository().create()
  const aiMessage = {
    id: 'remote-message',
    role: 'assistant' as const,
    content: '',
    toolCalls: [],
    createdAt: new Date().toISOString(),
  }
  chatSession.messages.push(aiMessage)
  const aiContext = {
    registry: remoteRegistry,
    actor: { user: session.user, sessionHash: 'private-main-session' },
    session: chatSession,
    skills: new Set<string>(),
    modulePins: {},
    bindings: [],
    requestId: 'request',
    signal: new AbortController().signal,
    interact: async () => ({ ok: false }) as any,
    use: async (_key: string, factory: () => Promise<unknown>) => factory(),
  } as any
  const remoteResult = await executeTool(
    aiContext,
    {
      view: {
        id: 'run',
        requestId: 'request',
        assistantMessageId: aiMessage.id,
        status: 'running',
      },
      abort: new AbortController(),
    },
    aiMessage,
    {
      id: 'fixed-remote-call',
      name: `${id}_echo`,
      arguments: JSON.stringify({ text: 'hello' }),
    },
    new Map(),
    { save: async () => {} },
  )
  assert.equal(remoteResult.ok, true)
  if (remoteResult.ok) {
    assert.deepEqual((remoteResult.data as any).value, { text: 'hello' })
    assert.ok(!JSON.stringify(remoteResult).includes('private-main-session'))
  }

  await assert.rejects(
    recovered.invoke(
      user,
      id,
      release.releaseId,
      active.installation.generation,
      'private',
      {},
      randomUUID(),
    ),
    /权限/,
  )
  const other = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      username: 'test_platform_' + randomUUID().replaceAll('-', ''),
      password: 'test123',
      nickname: '隔离测试',
    },
  })
  assert.equal(other.statusCode, 201)
  const b = other.json().data
  users.push(b.user.id)
  await assert.rejects(recovered.events(b.user.id, id, { releaseId: release.releaseId, generation: active.installation.generation, channel: 'changed' }), /安装/)
  await assert.rejects(recovered.operation(b.user.id, pending.id), /不存在/)
  const release2 = {
    ...release,
    releaseId: `${id}-2`,
    manifest: { ...release.manifest, version: '2.0.0' },
    permissions: [...release.permissions, `${id}.new`],
  }
  const upgraded = new ApplicationPlatform(source, [release2])
  upgraded.bind(id, remote)
  await upgraded.initialize()
  const [staged] = await source.query(
    'SELECT status,published FROM application_releases WHERE release_id=?',
    [release2.releaseId],
  )
  assert.equal(staged.status, 'submitted')
  assert.equal(Number(staged.published), 0)
  // Fixture deploy approval: production publication is covered through the admin API in publishing.integration.ts.
  await source.transaction(async (db) => {
    await db.query(
      'UPDATE application_releases SET published=0,status=\'retired\' WHERE app_id=?',
      [id],
    )
    await db.query(
      'UPDATE application_releases SET published=1,status=\'published\' WHERE release_id=?',
      [release2.releaseId],
    )
  })
  const olderWorker = new ApplicationPlatform(source, [release])
  olderWorker.bind(id, remote)
  await olderWorker.initialize()
  const [published] = await source.query(
    'SELECT release_id FROM application_releases WHERE app_id=? AND published=1',
    [id],
  )
  assert.equal(
    published.release_id,
    release2.releaseId,
    'old worker must not republish a retired version',
  )

  await assert.rejects(
    upgraded.change(
      user,
      id,
      'update',
      release2.releaseId,
      randomUUID(),
      release.permissions,
    ),
    /权限/,
  )
  assert.equal(
    (await upgraded.assertActive(user, id)).installation.releaseId,
    release.releaseId,
  )
  const updated = await upgraded.change(
    user,
    id,
    'update',
    release2.releaseId,
    randomUUID(),
    release2.permissions,
  )
  assert.equal(updated.status, 'completed')
  await assert.rejects(upgraded.events(user, id, { releaseId: release.releaseId, generation: active.installation.generation, channel: 'changed' }), /重新打开/)
  await assert.rejects(
    upgraded.invoke(
      user,
      id,
      release.releaseId,
      active.installation.generation,
      'echo',
      {},
      randomUUID(),
    ),
    /重新打开/,
  )
  dropReply = true
  const uninstalled = await upgraded.change(
    user,
    id,
    'uninstall',
    release2.releaseId,
    randomUUID(),
    [],
  )
  assert.equal(uninstalled.status, 'pending')
  await assert.rejects(upgraded.assertActive(user, id), /安装/)
  await assert.rejects(
    upgraded.change(
      user,
      id,
      'install',
      release2.releaseId,
      randomUUID(),
      release2.permissions,
    ),
    /正在处理/,
  )
  await source.query(
    'UPDATE application_lifecycle_operations SET next_attempt_at=UTC_TIMESTAMP(3) WHERE id=?',
    [uninstalled.id],
  )
  await upgraded.recover()
  assert.equal(
    (await upgraded.operation(user, uninstalled.id)).status,
    'completed',
  )
  const repeats = await Promise.all([
    upgraded.change(
      user,
      id,
      'install',
      release2.releaseId,
      'same-request',
      release2.permissions,
    ),
    upgraded.change(
      user,
      id,
      'install',
      release2.releaseId,
      'same-request',
      release2.permissions,
    ),
  ])
  assert.equal(repeats[0].id, repeats[1].id)
  assert.equal(
    (await upgraded.assertActive(user, id)).installation.generation,
    2,
  )
  await source.query(
    'UPDATE application_installations SET grants=JSON_ARRAY() WHERE user_id=? AND app_id=?',
    [user, id],
  )
  await assert.rejects(upgraded.assertActive(user, id), /权限已撤销/)

  assert.equal(
    JSON.stringify(await upgraded.catalog(user)).includes(
      'fixture-service-credential',
    ),
    false,
  )
  console.info(
    'Application platform integration passed: install/uninstall, grants, AI gating, restart reconciliation, upgrades and remote isolation.',
  )
} finally {
  await app.close()
  await cleanupUsers(source, users)
  await source.query('DELETE FROM application_releases WHERE app_id=?', [id])
  await source.query('DELETE FROM application_registry WHERE app_id=?', [id])
  await source.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
