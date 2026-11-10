/** Creates and drops its own database. Never mutates the configured application database. */
import type { NotificationContent } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { createConnection } from 'mysql2/promise'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { initializeDatabase } from '../src/db/initialize.js'
import { databaseSchemas } from '../src/db/schema/index.js'
import { IdentityService } from '../src/identity/service.js'
import { NotificationService } from '../src/notifications/service.js'
import { registerNotificationSocket } from '../src/notifications/socket.js'
import { registerPlatform } from '../src/platform/routes.js'
import { PlatformService } from '../src/platform/service.js'
import { TaskStore } from '../src/tasks/store.js'

const config = getConfig().mysql
const name = `t_box_test_notifications_${randomUUID().replaceAll('-', '')}`
const { database: _database, ...options } = config
const admin = await createConnection(options)
const source = createDataSource({ ...config, database: name })
const server = Fastify()
const sockets: { terminate(): void }[] = []
const content: NotificationContent = {
  style: 'action',
  title: '等待手机添加日程',
  body: '云端日程已保存。',
  actions: [{ label: '查看日程', target: { type: 'application', appId: 'calendar', params: { eventId: randomUUID(), date: '2026-11-02' } } }],
}
const wait = async (check: () => boolean, timeout = 7000) => {
  const end = Date.now() + timeout
  while (!check()) {
    assert.ok(Date.now() < end, 'Timed out waiting for notification update')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
try {
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await source.initialize()
  await initializeDatabase(source, databaseSchemas)
  assert.equal((await initializeDatabase(source, databaseSchemas)).upgraded, 0, 'Extension initialization is repeatable')
  const foreignKeys = await source.query('SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME IN (?,?)', [name, 'system_notifications', 'system_notification_cursors'])
  assert.equal(foreignKeys.length, 0)
  const identity = new IdentityService(source, undefined, 'internal')
  const notifications = new NotificationService(source)
  const tasks = new TaskStore(source)
  const users = await Promise.all([1, 2].map((id) => identity.register({ username: `notifications_${id}`, password: 'test123' }, `notifications-${id}`)))
  const actors = await Promise.all(users.map((user) => identity.authenticate(user.token)))
  const actor = actors[0]!
  const other = actors[1]!
  const first = await notifications.publish(actor.user.id, 'calendar', 'event:one', content)
  const duplicated = await Promise.all([notifications.publish(actor.user.id, 'calendar', 'event:one', content), notifications.publish(actor.user.id, 'calendar', 'event:one', content)])
  assert.ok(duplicated.every((item) => item.id === first.id), 'Parallel delivery is idempotent')
  assert.equal((await notifications.list(other)).unread, 0)
  await assert.rejects(notifications.read(other, first.id), { code: 'NOTIFICATION_NOT_FOUND' })
  await notifications.read(actor, first.id)
  assert.equal((await notifications.list(actor)).unread, 0)
  await notifications.read(actor, first.id, false)
  assert.equal((await notifications.list(actor, { unread: true })).items.length, 1)
  await assert.rejects(notifications.publish(actor.user.id, 'calendar', 'unsafe', { ...content, actions: [{ label: '打开', target: { type: 'url', url: 'javascript:alert(1)' } as never }] }), { code: 'INVALID_ARGUMENTS' })
  await assert.rejects(notifications.publish(actor.user.id, 'calendar', 'missing-image', { ...content, style: 'image', imageResourceId: randomUUID() }), { code: 'INVALID_ARGUMENTS' })
  const imageId = randomUUID()
  await source.query(`INSERT INTO resources(id,user_id,name,mime_type,size,source,object_path) VALUES(?,?,?,'image/png',10,'generated',?)`, [imageId, actor.user.id, '测试图片', 'test-image'])
  const image = await notifications.publish(actor.user.id, 'images', `image:${imageId}`, { style: 'image', title: '图片已生成', imageResourceId: imageId, actions: [] })
  assert.equal(image.imageResourceId, imageId)
  await assert.rejects(notifications.publish(other.user.id, 'images', 'foreign-image', { style: 'image', title: '图片', imageResourceId: imageId, actions: [] }), { code: 'INVALID_ARGUMENTS' })
  for (let index = 0; index < 64; index++) {
    await notifications.publish(actor.user.id, 'system', `page:${index}`, { style: index % 2 ? 'info' : 'warning', title: `消息 ${index}`, actions: [] })
  }
  const ids: string[] = []
  let cursor: string | undefined
  do {
    const page = await notifications.list(actor, { cursor })
    ids.push(...page.items.map((item) => item.id))
    assert.equal(page.unread, 66, 'Unread count covers every page')
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  assert.equal(ids.length, 66)
  assert.equal(new Set(ids).size, 66, 'Stable ordering prevents gaps or duplicates for same-time records')
  await assert.rejects(notifications.list(actor, { cursor: 'invalid' }), { code: 'INVALID_ARGUMENTS' })
  const taskId = randomUUID()
  await tasks.create(actor, taskId, randomUUID(), 'notification-task', { secret: 'never-copy-this-to-notifications' }, 'fixture')
  await source.query('UPDATE agent_tasks SET status=\'waiting_client\',recovery_ready=FALSE WHERE id=?', [taskId])
  await notifications.recover()
  assert.equal((await notifications.list(actor)).items.some((item) => item.taskId === taskId), false, 'AI waits stay in the assistant instead of the system inbox')
  for (const status of ['completed', 'paused', 'needs_review']) {
    await source.query('UPDATE agent_tasks SET status=?,active_key=NULL,recovery_ready=FALSE WHERE id=?', [status, taskId])
    const inbox = await notifications.list(actor)
    assert.equal(inbox.unread, 66, 'AI state changes do not increase system unread counts')
    assert.equal(JSON.stringify(inbox).includes('never-copy-this'), false)
  }
  // Retire old derived messages without touching tasks, generated images or deliberate business messages.
  const legacyTask = randomUUID()
  await tasks.create(actor, legacyTask, randomUUID(), 'legacy-task', {}, 'fixture')
  await source.query('UPDATE agent_tasks SET status=\'completed\',active_key=NULL,recovery_ready=FALSE WHERE id=?', [legacyTask])
  const legacyId = randomUUID()
  await source.query('INSERT INTO user_notifications(id,user_id,source_key,task_id,kind,read_at) VALUES(?,?,?,?, \'completed\',UTC_TIMESTAMP(3))', [legacyId, actor.user.id, `${legacyTask}:completed`, legacyTask])
  const quietRevision = await notifications.revision(actor)
  await source.query('INSERT INTO system_notifications(id,user_id,source_app_id,source_key,task_id,kind,content) VALUES(?,?,\'system\',?,?, \'task.completed\',?)', [legacyId, actor.user.id, `${legacyTask}:completed`, legacyTask, JSON.stringify(content)])
  const generatedId = randomUUID()
  await source.query('INSERT INTO resources(id,user_id,name,mime_type,size,source,object_path) VALUES(?,?,?,\'image/png\',10,\'generated\',?)', [generatedId, actor.user.id, '普通 AI 图片', 'ordinary-image'])
  await source.query('INSERT INTO system_notifications(id,user_id,source_app_id,source_key,kind,content) VALUES(?,?,\'images\',?,\'image.completed\',?)', [randomUUID(), actor.user.id, `image:${generatedId}`, JSON.stringify(content)])
  assert.equal(await notifications.revision(actor), quietRevision, 'Retired AI messages cannot trigger system inbox invalidation')
  await notifications.recover()
  await notifications.recover()
  assert.equal((await source.query('SELECT id FROM system_notifications WHERE id=?', [legacyId])).length, 0)
  assert.equal((await source.query('SELECT id FROM system_notifications WHERE kind=\'image.completed\'')).length, 0)
  assert.equal((await source.query('SELECT id FROM agent_tasks WHERE id=?', [legacyTask])).length, 1, 'Conversation tasks remain available in AI')
  assert.equal((await source.query('SELECT id FROM resources WHERE id=?', [generatedId])).length, 1, 'Generated images remain available')
  assert.equal((await notifications.list(actor)).unread, 66, 'Business/image-style notices remain, legacy task records are not re-imported')
  const due = { key: 'calendar:fixture:due', at: new Date().toISOString(), title: '会议', body: '日程提醒', destination: { appId: 'calendar', params: { eventId: randomUUID() } } }
  await source.query('UPDATE notification_watermark SET started_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)')
  const reminders = new NotificationService(source, async () => [due])
  await reminders.syncReminders(actor.user.id)
  await reminders.syncReminders(actor.user.id)
  const [reminderCount] = await source.query('SELECT COUNT(*) AS count FROM system_notifications WHERE kind=\'reminder\'')
  assert.equal(Number(reminderCount.count), 1)
  await source.query('DELETE FROM agent_tasks WHERE id IN (?,?)', [taskId, legacyTask])
  await notifications.recover()
  assert.equal((await source.query('SELECT id FROM system_notifications WHERE task_id IS NOT NULL')).length, 0, 'Application cleanup removes deleted task references without cascades')

  const platform = new PlatformService(source)
  const timer = await platform.time.create(actor.user.id, randomUUID(), { label: '实际倒计时', durationSeconds: 60 })
  const deadline = new Date(Date.now() - 2000).toISOString()
  await source.query('UPDATE app_timers SET data=JSON_SET(data,\'$.deadline\',?) WHERE id=?', [deadline, timer.id])
  await source.query('DELETE FROM system_notification_cursors WHERE user_id=?', [actor.user.id])
  await platform.notifications.syncReminders(actor.user.id)
  const [timerNotice] = await source.query('SELECT id,read_at FROM system_notifications WHERE user_id=? AND source_app_id=\'time\' AND kind=\'reminder\'', [actor.user.id])
  assert.ok(timerNotice, 'Canonical timer service feeds the common inbox')
  const timerKey = `time:${timer.id}:${deadline}`
  await platform.notifications.readReminder(other, timerKey)
  assert.equal((await source.query('SELECT read_at FROM system_notifications WHERE id=?', [timerNotice.id]))[0].read_at, null, 'Other accounts cannot acknowledge this device reminder')
  await platform.notifications.readReminder(actor, timerKey)
  assert.ok((await source.query('SELECT read_at FROM system_notifications WHERE id=?', [timerNotice.id]))[0].read_at, 'Local notification clicks acknowledge the matching inbox record')
  const failedSource = new NotificationService(source, async () => {
    throw new TypeError('Reminder source unavailable')
  })
  assert.ok((await failedSource.list(actor)).items.length, 'A failed reminder source cannot hide the durable inbox')
  registerPlatform(server, platform)
  await server.register(websocket)
  registerNotificationSocket(server, platform, new Set(['http://localhost:5173']))
  await server.ready()
  assert.equal((await server.inject({ url: '/api/v1/notifications' })).statusCode, 401)
  const headers = { authorization: `Bearer ${users[0]!.token}` }
  assert.equal((await server.inject({ url: '/api/v1/notifications?filter=unread', headers })).statusCode, 200)
  const invalid = await server.inject({ method: 'PATCH', url: `/api/v1/notifications/${first.id}/read`, headers, payload: { read: 'yes' } })
  assert.equal(invalid.statusCode, 400)
  const socket = await server.injectWS('/api/v1/notifications/ws', { headers: { origin: 'http://localhost:5173' } })
  sockets.push(socket)
  const events: { type: string, revision?: string }[] = []
  socket.on('message', (raw) => events.push(JSON.parse(raw.toString())))
  socket.send(JSON.stringify({ type: 'authenticate', token: users[0]!.token }))
  await wait(() => events.some((event) => event.type === 'notifications.changed'))
  const before = events.filter((event) => event.type === 'notifications.changed').length
  await notifications.read(actor)
  await wait(() => events.filter((event) => event.type === 'notifications.changed').length > before)
  assert.equal((await notifications.list(actor)).unread, 0)
  assert.equal(JSON.stringify(events).includes('会议'), false, 'Invalidation does not send message bodies')
  const closed = new Promise<number>((resolve) => socket.once('close', resolve))
  await source.query('DELETE FROM user_sessions WHERE token_hash=?', [actor.sessionHash])
  assert.equal(await closed, 1008, 'Revoked sessions lose their notification stream')
  console.log('System notifications passed: isolated schema, AI noise suppression, styles, safe targets, images, pagination, account isolation, reminders, HTTP and cross-device invalidation')
} finally {
  sockets.forEach((socket) => socket.terminate())
  await server.close()
  if (source.isInitialized) {
    await source.destroy()
  }
  await admin.query(`DROP DATABASE IF EXISTS \`${name}\``)
  await admin.end()
}
