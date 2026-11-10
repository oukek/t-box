import type { NotificationContent, NotificationInbox, SystemNotification } from '@t-box/app-contracts'
import type { Actor } from '@t-box/app-server-sdk'
import type { ReminderItem } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { StoredUserNotification } from '../db/records/operations-entities.js'
import { createHash, randomUUID } from 'node:crypto'
import { parseNotificationContent } from '@t-box/app-contracts'
import { isoTime } from '@t-box/server-foundation/time'
import { UserNotificationEntity } from '../db/records/operations-entities.js'
import { ErrorCode } from '../error-codes.js'

// Only the old automatic projections are retired; deliberate business messages keep their content/read state.
const automaticActivity = `(source_app_id='system' AND task_id IS NOT NULL
  AND kind IN ('task.completed','task.waiting_client','task.paused','task.needs_review'))
  OR (source_app_id='images' AND kind='image.completed' AND source_key LIKE 'image:%')`
const view = (row: StoredUserNotification): SystemNotification => ({
  ...row.content,
  id: row.id,
  sourceAppId: row.source_app_id,
  kind: row.kind,
  ...(row.task_id ? { taskId: row.task_id } : {}),
  read: !!row.read_at,
  readAt: row.read_at ? isoTime(row.read_at)! : null,
  createdAt: isoTime(row.created_at)!,
})

/** Durable account inbox. Producers are trusted server code; clients cannot send messages to users. */
export class NotificationService {
  private sweep?: Promise<void>
  private readonly reminderSync = new Map<string, Promise<void>>()
  constructor(readonly source: DataSource, private readonly reminders?: (userId: string, since: number) => Promise<ReminderItem[]>) {}

  /** Source identity is supplied by the server/application adapter, never by model or browser input. */
  async publish(userId: string, sourceAppId: string, sourceKey: string, content: NotificationContent, kind = 'message') {
    if (!/^[\da-f-]{36}$/i.test(userId) || !/^[a-z][a-z0-9_-]{0,63}$/.test(sourceAppId) || !sourceKey || sourceKey.length > 190 || !/^[\w.-]{1,80}$/.test(kind)) {
      throw ErrorCode.INVALID_ARGUMENTS('通知来源不正确')
    }
    let parsed: NotificationContent
    try {
      parsed = parseNotificationContent(content)
    } catch {
      throw ErrorCode.INVALID_ARGUMENTS('通知内容或跳转目标不正确')
    }
    const user = await this.source.createQueryBuilder().select('u.id', 'id').from('app_users', 'u').where('u.id=:user AND u.enabled=TRUE', { user: userId }).getRawOne()
    if (!user) {
      throw ErrorCode.UNAUTHENTICATED()
    }
    if (parsed.imageResourceId) {
      const resource = await this.source.createQueryBuilder().select('r.id', 'id').from('resources', 'r').where('r.id=:id AND r.user_id=:user AND r.deleted_at IS NULL AND r.mime_type LIKE :mime', { id: parsed.imageResourceId, user: userId, mime: 'image/%' }).getRawOne()
      if (!resource) {
        throw ErrorCode.INVALID_ARGUMENTS('通知图片不可访问')
      }
    }
    await this.source.createQueryBuilder().insert().into(UserNotificationEntity).values({
      id: randomUUID(),
      user_id: userId,
      source_app_id: sourceAppId,
      source_key: sourceKey,
      task_id: null,
      kind,
      content: parsed,
      read_at: null,
    }).orIgnore().execute()
    const row = await this.source.getRepository(UserNotificationEntity).findOneByOrFail({ user_id: userId, source_app_id: sourceAppId, source_key: sourceKey })
    return view(row)
  }

  recover(): Promise<void> {
    this.sweep ??= this.collect().finally(() => {
      this.sweep = undefined
    })
    return this.sweep
  }

  private async collect() {
    // AI progress belongs to the assistant. Do not re-import legacy task notifications.
    await this.source.createQueryBuilder().delete().from(UserNotificationEntity).where(automaticActivity).execute()
    // Ordinary IDs and application cleanup replace database cascades for the new inbox.
    // native-sql: multi-table orphan cleanup atomically validates both task ownership and user existence.
    await this.source.query(`DELETE n FROM system_notifications n LEFT JOIN agent_tasks t ON t.id=n.task_id AND t.user_id=n.user_id
      LEFT JOIN app_users u ON u.id=n.user_id WHERE u.id IS NULL OR (n.task_id IS NOT NULL AND t.id IS NULL)`)
    // native-sql: multi-table orphan cleanup removes only cursors whose owner no longer exists.
    await this.source.query('DELETE c FROM system_notification_cursors c LEFT JOIN app_users u ON u.id=c.user_id WHERE u.id IS NULL')
  }

  async syncReminders(userId: string) {
    if (!this.reminders) {
      return
    }
    let pending = this.reminderSync.get(userId)
    if (!pending) {
      pending = this.collectReminders(userId).finally(() => this.reminderSync.delete(userId))
      this.reminderSync.set(userId, pending)
    }
    return pending
  }

  private async collectReminders(userId: string) {
    const now = Date.now()
    const cursor = await this.source.createQueryBuilder().select('COALESCE(c.reminders_at,w.started_at)', 'since').from('notification_watermark', 'w').leftJoin('system_notification_cursors', 'c', 'c.user_id=:user', { user: userId }).where('w.id=1').getRawOne()
    const since = Math.max(new Date(cursor?.since ?? now).getTime(), now - 7 * 86400000)
    const reminders = await this.reminders!(userId, since)
    for (const item of reminders) {
      const at = Date.parse(item.at)
      if (!Number.isFinite(at) || at < since || at > now) {
        continue
      }
      await this.publish(userId, item.destination.appId, `reminder:${createHash('sha256').update(item.key).digest('hex')}`, {
        style: 'info',
        title: item.title || '日程提醒',
        body: item.body,
        actions: [{ label: '查看详情', target: { type: 'application', ...item.destination } }],
      }, 'reminder')
    }
    // Advance only after both sources and every insert succeeded. Concurrent scans never move backwards.
    // native-sql: monotonic upsert prevents a slower concurrent scanner from moving the shared cursor backwards.
    await this.source.query(`INSERT INTO system_notification_cursors(user_id,reminders_at) VALUES(?,?)
      ON DUPLICATE KEY UPDATE reminders_at=GREATEST(reminders_at,VALUES(reminders_at))`, [userId, new Date(now)])
  }

  async list(actor: Actor, options: { unread?: boolean, cursor?: string } = {}): Promise<NotificationInbox> {
    await this.recover()
    // A failed reminder source must not make the durable inbox unavailable. Its cursor is retained.
    await this.syncReminders(actor.user.id).catch(() => {})
    const query = this.source.getRepository(UserNotificationEntity).createQueryBuilder('n').where('n.user_id=:user', { user: actor.user.id }).andWhere(`NOT (${automaticActivity})`)
    if (options.unread) {
      query.andWhere('n.read_at IS NULL')
    }
    if (options.cursor) {
      try {
        if (options.cursor.length > 256) {
          throw ErrorCode.INVALID_ARGUMENTS('通知分页参数不正确')
        }
        const [at, id] = JSON.parse(Buffer.from(options.cursor, 'base64url').toString())
        if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id)) {
          throw ErrorCode.INVALID_ARGUMENTS('通知分页参数不正确')
        }
        query.andWhere('(n.created_at<:at OR (n.created_at=:at AND n.id<:id))', { at: new Date(at), id })
      } catch {
        throw ErrorCode.INVALID_ARGUMENTS('通知分页参数不正确')
      }
    }
    const rows = await query.orderBy('n.created_at', 'DESC').addOrderBy('n.id', 'DESC').take(31).getMany()
    const items = rows.slice(0, 30)
    const last = items.at(-1)
    return {
      unread: await this.source.getRepository(UserNotificationEntity).createQueryBuilder('n').where('n.user_id=:user AND n.read_at IS NULL', { user: actor.user.id }).andWhere(`NOT (${automaticActivity})`).getCount(),
      items: items.map(view),
      nextCursor: rows.length > 30 && last ? Buffer.from(JSON.stringify([isoTime(last.created_at), last.id])).toString('base64url') : null,
    }
  }

  async readReminder(actor: Actor, key: string) {
    if (!key || key.length > 512) {
      throw ErrorCode.INVALID_ARGUMENTS('提醒标识不正确')
    }
    await this.syncReminders(actor.user.id)
    await this.source.createQueryBuilder().update(UserNotificationEntity).set({ read_at: () => 'COALESCE(read_at,UTC_TIMESTAMP(3))' }).where('user_id=:user AND kind=:kind AND source_key=:key', {
      user: actor.user.id,
      kind: 'reminder',
      key: `reminder:${createHash('sha256').update(key).digest('hex')}`,
    }).execute()
  }

  async revision(actor: Actor) {
    const row = await this.source.createQueryBuilder().select('COUNT(*)', 'total').addSelect('SUM(n.read_at IS NULL)', 'unread').addSelect('MAX(n.created_at)', 'latest').addSelect('MAX(n.read_at)', 'last_read').from('system_notifications', 'n').where('n.user_id=:user', { user: actor.user.id }).andWhere(`NOT (${automaticActivity})`).getRawOne()
    return createHash('sha256').update(JSON.stringify(row)).digest('hex')
  }

  async read(actor: Actor, id?: string, read = true) {
    if (id && !await this.source.getRepository(UserNotificationEntity).existsBy({ id, user_id: actor.user.id })) {
      throw ErrorCode.NOTIFICATION_NOT_FOUND()
    }
    const update = this.source.createQueryBuilder().update(UserNotificationEntity).set({ read_at: read ? () => 'COALESCE(read_at,UTC_TIMESTAMP(3))' : null }).where('user_id=:userId', { userId: actor.user.id })
    if (id) {
      update.andWhere('id=:id', { id })
    }
    await update.execute()
  }
}
