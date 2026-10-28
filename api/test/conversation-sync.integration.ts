import type { BillRepository } from '@t-box/ledger-server/repository'
import type { ChatServerEvent } from '@t-box/shared'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { ApplicationChatService } from '../src/bootstrap/chat.js'
import { ConversationArchive } from '../src/chat/archive.js'
import { MemorySessionRepository } from '../src/chat/session.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { FixtureChatProvider } from './chat-provider-fixture.js'
import { assertDisposableDatabase, cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
assertDisposableDatabase(source.options.database)
const platform = new PlatformService(source)
const service = new ApplicationChatService({ platform, bills: {} as BillRepository, provider: new FixtureChatProvider() })
const userIds: string[] = []
const connections: ReturnType<ApplicationChatService['connect']>[] = []
async function until(check: () => boolean, timeout = 6000) {
  const end = Date.now() + timeout
  while (!check()) {
    assert.ok(Date.now() < end, 'Socket state did not automatically synchronize')
    await pause(20)
  }
}
try {
  const login = await platform.identity.register({ username: `sync_${randomUUID().replaceAll('-', '')}`, password: 'test123' }, 'fixture')
  userIds.push(login.user.id)
  const actor = await platform.identity.authenticate(login.token)
  const saved = new MemorySessionRepository().create()
  saved.userId = login.user.id
  saved.conversationId = randomUUID()
  saved.messages = [{ id: randomUUID(), role: 'user', content: '多端同步测试', toolCalls: [], createdAt: new Date().toISOString() }]
  await platform.conversations.save(saved)
  const desktop: ChatServerEvent[] = []
  const phone: ChatServerEvent[] = []
  for (const events of [desktop, phone]) {
    const connection = service.connect((event) => events.push(structuredClone(event)))
    connections.push(connection)
    await connection.receive({ type: 'session.open', authToken: login.token, conversationId: saved.conversationId })
    assert.equal(events[0]?.type, 'session.ready')
  }
  const contains = (events: ChatServerEvent[], text: string) => events.some((event) => event.type === 'session.snapshot' && event.snapshot.messages.some((message) => message.content === text))
  saved.messages.push({ id: randomUUID(), role: 'assistant', content: '本进程提交立即同步', toolCalls: [], createdAt: new Date().toISOString() })
  await platform.conversations.save(saved)
  await until(() => contains(phone, '本进程提交立即同步') && contains(desktop, '本进程提交立即同步'), 1500)
  // A separate archive instance represents another process: it shares MySQL, not listeners.
  const workerArchive = new ConversationArchive(source, service.access)
  saved.messages.push({ id: randomUUID(), role: 'assistant', content: '独立 worker 提交也自动同步', toolCalls: [], createdAt: new Date().toISOString() })
  await workerArchive.save(saved)
  await until(() => contains(phone, '独立 worker 提交也自动同步'))
  await workerArchive.rename(actor, saved.conversationId!, { title: '另一设备修改的标题' })
  await until(() => phone.some((event) => event.type === 'session.snapshot' && event.snapshot.title === '另一设备修改的标题'))
  const taskId = randomUUID()
  await platform.tasks.create(actor, taskId, saved.conversationId!, randomUUID(), {}, 'assistant', true, saved.archiveRevision)
  await until(() => phone.some((event) => event.type === 'session.snapshot' && event.snapshot.task?.status === 'queued'))
  await platform.tasks.cancel(actor, taskId)
  await workerArchive.remove(actor, saved.conversationId!)
  await until(() => phone.some((event) => event.type === 'session.snapshot' && !event.snapshot.conversationId && !event.snapshot.messages.length))
  console.log('Conversation sync integration passed: independent transports, immediate local commits, cross-process commits, titles, task states and deletion are pushed over Socket without client polling.')
} finally {
  connections.forEach((connection) => connection.close())
  await service.close()
  await cleanupUsers(source, userIds)
  await source.destroy()
}
