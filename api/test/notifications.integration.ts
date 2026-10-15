import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const users: string[] = []
try {
  const actors = []
  for (let index = 0; index < 2; index++) {
    const result = await platform.identity.register({ username: `notify_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '通知测试' }, `notify-fixture-${index}`)
    users.push(result.user.id)
    actors.push(await platform.identity.authenticate(result.token))
  }
  const actor = actors[0]!
  const taskId = randomUUID()
  const queued = randomUUID()
  for (const id of [taskId, queued]) {
    await platform.tasks.create(actor, id, randomUUID(), `notify-${id}`, { protected: 'private-content-never-in-notification' }, 'fixture')
  }
  await source.query('UPDATE agent_tasks SET status=\'waiting_client\',recovery_ready=FALSE,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [taskId])
  await Promise.all([platform.notifications.recover(), platform.notifications.recover()])
  const inbox = await platform.notifications.list(actor)
  assert.equal(inbox.unread, 1)
  assert.equal(inbox.items.length, 1)
  assert.equal(inbox.items[0]!.title, '任务等待你处理')
  assert.equal(JSON.stringify(inbox).includes('private-content'), false)
  assert.equal((await platform.notifications.list(actors[1]!)).items.length, 0)
  await assert.rejects(platform.notifications.read(actors[1]!, inbox.items[0]!.id), { code: 'NOTIFICATION_NOT_FOUND' })
  await platform.notifications.read(actor, inbox.items[0]!.id)
  assert.equal((await platform.notifications.list(actor)).unread, 0)
  await platform.notifications.recover()
  assert.equal((await platform.notifications.list(actor)).items.length, 1, 'Committed delivery is deduplicated after reconnect')
  await source.query('UPDATE agent_tasks SET status=\'completed\',active_key=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [taskId])
  assert.equal((await platform.notifications.list(actor)).unread, 1)
  await source.query('UPDATE agent_tasks SET status=\'paused\',recovery_ready=TRUE,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [queued])
  assert.equal((await platform.notifications.list(actor)).items.length, 2, 'Automatic recovery pauses do not notify the user to intervene')
  await platform.notifications.read(actor)
  assert.equal((await platform.notifications.list(actor)).unread, 0)
  await source.query('DELETE FROM agent_tasks WHERE id=?', [taskId])
  assert.equal((await platform.notifications.list(actor)).items.length, 0, 'Deleting a task removes its inbox references')
  console.log('Notification integration passed: durable task-state delivery, deduplication, unread state, account isolation and protected content privacy')
} finally {
  await cleanupUsers(source, users)
  await source.destroy()
}
