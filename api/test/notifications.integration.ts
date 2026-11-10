import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { assertDisposableDatabase, cleanupUsers } from './fixtures.js'

assertDisposableDatabase(process.env.MYSQL_DATABASE)
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
  await platform.tasks.create(actor, taskId, randomUUID(), `notify-${taskId}`, { protected: 'private-content-never-in-notification' }, 'fixture')
  for (const status of ['waiting_client', 'completed', 'paused', 'needs_review']) {
    await source.query('UPDATE agent_tasks SET status=?,active_key=NULL,recovery_ready=FALSE,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [status, taskId])
    await Promise.all([platform.notifications.recover(), platform.notifications.recover()])
    const inbox = await platform.notifications.list(actor)
    assert.equal(inbox.unread, 0)
    assert.equal(inbox.items.length, 0, 'Routine AI activity stays in AI')
    assert.equal(JSON.stringify(inbox).includes('private-content'), false)
  }
  const notification = await platform.notifications.publish(actor.user.id, 'calendar', `event:${randomUUID()}`, {
    style: 'info',
    title: '日程提醒',
    actions: [{ label: '打开日历', target: { type: 'application', appId: 'calendar', params: {} } }],
  }, 'reminder')
  assert.equal((await platform.notifications.list(actor)).unread, 1)
  assert.equal((await platform.notifications.list(actors[1]!)).items.length, 0)
  await assert.rejects(platform.notifications.read(actors[1]!, notification.id), { code: 'NOTIFICATION_NOT_FOUND' })
  await platform.notifications.read(actor, notification.id)
  assert.equal((await platform.notifications.list(actor)).unread, 0)
  await platform.notifications.recover()
  assert.equal((await platform.notifications.list(actor)).items.length, 1, 'Business messages retain their read state')
  await source.query('DELETE FROM agent_tasks WHERE id=?', [taskId])
  assert.equal((await platform.notifications.list(actor)).items.length, 1, 'AI task lifecycle does not delete unrelated business notices')
  console.log('Notification integration passed: quiet AI activity, business notifications, read state and account isolation')
} finally {
  await cleanupUsers(source, users)
  await source.destroy()
}
