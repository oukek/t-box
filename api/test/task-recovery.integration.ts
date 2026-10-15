import type { ChatServerEvent } from '@t-box/shared'
import type { RunCheckpoint } from '../src/agent/checkpoint.js'
import type { ChatProvider } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { ApplicationChatService } from '../src/bootstrap/chat.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { TaskRecoveryWorker } from '../src/tasks/worker.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const users: string[] = []
const services: ApplicationChatService[] = []
const workers: TaskRecoveryWorker[] = []
async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 7000
  while (!await check()) {
    assert.ok(Date.now() < end, 'Recovery timed out')
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}
try {
  const login = await platform.identity.register({ username: `recovery_${randomUUID().replaceAll('-', '')}`, password: 'test123' }, 'task-recovery-fixture')
  users.push(login.user.id)
  const actor = await platform.identity.authenticate(login.token)
  const book = (await platform.ledgers.list(actor))[0]!
  const [{ id: category }] = await source.query('SELECT id FROM bill_categories WHERE ledger_id=? AND type=\'expense\' LIMIT 1', [book.id])
  let stopping = true
  let enteredAfterWrite = false
  let asksClient = false
  let models = 0
  const provider: ChatProvider = {
    mode: 'openai',
    configurationKey: 'recovery-test-provider',
    async next(input) {
      models++
      const outputs = input.history.filter((item) => item.type === 'function_call_output')
      if (!outputs.length) {
        const args = JSON.stringify({ type: 'expense', amount: '1', category, date: '2026-10-15', note: 'recovery-once' })
        return { calls: [{ id: 'write-once', name: 'bills_create', arguments: args }], output: [{ type: 'function_call', call_id: 'write-once', name: 'bills_create', arguments: args }] }
      }
      if (stopping) {
        enteredAfterWrite = true
        await new Promise((_resolve, reject) => {
          if (input.signal.aborted) {
            reject(input.signal.reason)
          } else {
            input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
          }
        })
      }
      if (asksClient) {
        const args = JSON.stringify({ appId: 'ledger', params: null })
        return { calls: [{ id: 'open-app', name: 'app_open', arguments: args }], output: [{ type: 'function_call', call_id: 'open-app', name: 'app_open', arguments: args }] }
      }
      return { calls: [], output: [{ role: 'assistant', content: '已记账一次，自动恢复完成。' }] }
    },
  }
  function chat() {
    const service = new ApplicationChatService({ platform, bills: createBillRepository(source), provider })
    services.push(service)
    return service
  }
  const first = chat()
  const events: ChatServerEvent[] = []
  const connection = first.connect((event) => events.push(event))
  await connection.receive({ type: 'session.open', authToken: login.token })
  await connection.receive({ type: 'message.send', requestId: 'shutdown-recovery', text: '记一元', localDate: '2026-10-15', applicationIds: ['ledger'], scopeBindings: [{ appId: 'ledger', resourceType: 'book', resourceId: book.id }] })
  await until(async () => enteredAfterWrite)
  const session = [...first.sessions.all()][0]!
  const taskId = session.active!.view.id
  const conversationId = session.conversationId!
  connection.close()
  await first.close()
  assert.equal((await platform.tasks.get(actor, taskId)).summary.status, 'paused')
  const [eligible] = await source.query('SELECT recovery_ready,recovery_auth_hash,checkpoint_json FROM agent_tasks WHERE id=?', [taskId])
  assert.equal(Number(eligible.recovery_ready), 1)
  assert.equal(eligible.recovery_auth_hash, actor.sessionHash)
  assert.equal(JSON.stringify((await platform.tasks.get(actor, taskId)).checkpoint).includes(actor.sessionHash), false, 'Identity must stay outside model checkpoints')
  const template = JSON.parse(eligible.checkpoint_json) as RunCheckpoint
  await source.query('UPDATE agent_tasks SET recovery_after=UTC_TIMESTAMP(3) WHERE id=?', [taskId])
  stopping = false
  const restarted = chat()
  const worker = new TaskRecoveryWorker(platform.tasks, restarted)
  workers.push(worker)
  await Promise.all([worker.tick(), worker.tick()])
  await until(async () => (await platform.tasks.get(actor, taskId)).summary.status === 'completed')
  assert.equal((await source.query('SELECT id FROM bills WHERE ledger_id=? AND note=?', [book.id, 'recovery-once'])).length, 1)
  assert.equal((await platform.tasks.get(actor, taskId)).tools.length, 1)
  assert.equal([...restarted.sessions.all()].length, 0, 'Headless sessions must be released')

  async function seed() {
    const id = randomUUID()
    const conversation = randomUUID()
    const cp = structuredClone(template)
    cp.runId = id
    cp.requestId = id
    await platform.tasks.create(actor, id, conversation, id, cp, 'ledger')
    await source.query('UPDATE agent_tasks SET recovery_after=UTC_TIMESTAMP(3) WHERE id=?', [id])
    return { id, conversation }
  }
  // Two independent workers cannot reserve the same queued task.
  const contested = await seed()
  const reservations = await Promise.all([platform.tasks.takeRecovery(randomUUID()), platform.tasks.takeRecovery(randomUUID())])
  assert.equal(reservations.filter((task) => task?.id === contested.id).length, 1)
  await platform.tasks.cancel(actor, contested.id)

  const uncertain = await seed()
  await platform.tasks.claim(actor, uncertain.id, 'crashed-owner')
  await platform.tasks.journal(uncertain.id, 'crashed-owner').dispatch({ id: 'uncertain', name: 'fixture_write', arguments: '{}' }, 'write', 'ledger')
  await source.query('UPDATE agent_tasks SET lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?', [uncertain.id])
  await platform.tasks.recover()
  assert.equal((await platform.tasks.get(actor, uncertain.id)).summary.status, 'needs_review')
  assert.equal(await platform.tasks.takeRecovery(randomUUID()), undefined)

  // A server error is a manual pause, never an automatic background retry loop.
  const failed = await seed()
  await platform.tasks.claim(actor, failed.id, 'normal-failure')
  await platform.tasks.finish(failed.id, 'normal-failure', 'paused', 'fixture provider failure')
  assert.equal(await platform.tasks.takeRecovery(randomUUID()), undefined)

  // A recovered run reaches the client boundary and stops without inventing consent.
  asksClient = true
  const client = await seed()
  await worker.tick()
  await until(async () => (await platform.tasks.get(actor, client.id)).summary.status === 'waiting_client')
  const beforeWait = models
  await worker.tick()
  assert.equal(models, beforeWait)
  asksClient = false

  const revoked = await seed()
  await platform.identity.logout(actor)
  const beforeRevocation = models
  await worker.tick()
  await until(async () => (await platform.tasks.get(actor, revoked.id)).summary.status === 'waiting_client')
  assert.equal(models, beforeRevocation, 'Revoked identity must never reach a model')
  assert.ok(conversationId)
  console.log('Task recovery integration passed: graceful restart, single write, reservations, uncertainty fencing, manual failures, frontend wait, revoked identity and session cleanup')
} finally {
  for (const worker of workers) {
    await worker.stopScheduling()
  }
  for (const service of services) {
    await service.close()
  }
  for (const worker of workers) {
    await worker.drain()
  }
  await cleanupUsers(source, users)
  await source.destroy()
}
