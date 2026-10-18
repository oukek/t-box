import type { Actor } from '@t-box/app-server-sdk'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { isoTime } from '@t-box/server-foundation/time'
import { IsNull } from 'typeorm'
import { UserNotificationEntity } from '../db/records/operations-entities.js'
import { ErrorCode } from '../error-codes.js'

const labels: Record<string, string> = {
  completed: '任务已完成',
  waiting_client: '任务等待你处理',
  paused: '任务已暂停，请查看执行记录',
  needs_review: '任务有待核对的操作，请查看执行记录',
}
/** Durable inbox derives from committed task states, independent of sockets or a live device. */
export class NotificationService {
  private sweep?: Promise<void>
  constructor(readonly source: DataSource) {}
  recover(): Promise<void> {
    this.sweep ??= this.collect().finally(() => {
      this.sweep = undefined
    })
    return this.sweep
  }

  private async collect() {
    const rows = await this.source
      .createQueryBuilder()
      .select('t.id,t.user_id,t.status,t.updated_at')
      .from('agent_tasks', 't')
      .innerJoin(
        'notification_watermark',
        'w',
        'w.id=1 AND t.updated_at>=w.started_at',
      )
      .where(
        't.status IN (\'completed\',\'waiting_client\',\'paused\',\'needs_review\') AND t.recovery_ready=FALSE\n      AND NOT EXISTS (SELECT 1 FROM user_notifications n WHERE n.user_id=t.user_id AND n.source_key=CONCAT(t.id,\':\',t.status))',
      )
      .orderBy('t.updated_at', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .limit(256)
      .getRawMany()
    for (const row of rows) {
      // Recheck the exact state, including its timestamp, after the nonlocking scan.
      // native-sql: atomic insert-select projection or state-transition notification
      await this.source.query(
        `INSERT IGNORE INTO user_notifications(id,user_id,source_key,task_id,kind)
        SELECT ?,user_id,CONCAT(id,':',status),id,status FROM agent_tasks WHERE id=? AND status=? AND updated_at=? AND recovery_ready=FALSE`,
        [randomUUID(), row.id, row.status, row.updated_at],
      )
    }
  }

  async list(actor: Actor) {
    await this.recover()
    const rows = await this.source.getRepository(UserNotificationEntity).find({
      select: {
        id: true,
        task_id: true,
        kind: true,
        read_at: true,
        created_at: true,
      },
      where: { user_id: actor.user.id },
      order: { created_at: 'DESC', id: 'DESC' },
      take: 100,
    })
    const unread = await this.source
      .getRepository(UserNotificationEntity)
      .countBy({ user_id: actor.user.id, read_at: IsNull() })
    return {
      unread,
      items: rows.map((row) => ({
        id: row.id,
        taskId: row.task_id,
        title: labels[row.kind] || '任务状态已更新',
        read: !!row.read_at,
        createdAt: isoTime(row.created_at)!,
      })),
    }
  }

  async read(actor: Actor, id?: string) {
    if (id) {
      const owned = await this.source
        .getRepository(UserNotificationEntity)
        .findOne({
          select: { id: true },
          where: { id, user_id: actor.user.id },
        })
      if (!owned) {
        throw ErrorCode.NOTIFICATION_NOT_FOUND()
      }
    }
    const update = this.source
      .createQueryBuilder()
      .update('user_notifications')
      .set({ read_at: () => 'COALESCE(read_at,UTC_TIMESTAMP(3))' })
      .where('user_id=:userId', { userId: actor.user.id })
    if (id) {
      update.andWhere('id=:id', { id })
    }
    await update.execute()
  }
}
