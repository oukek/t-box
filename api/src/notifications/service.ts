import type { Actor } from '@t-box/app-server-sdk'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'
import { isoTime } from '@t-box/server-foundation/time'

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
    const rows = await this.source.query(`SELECT t.id,t.user_id,t.status,t.updated_at FROM agent_tasks t
      JOIN notification_watermark w ON w.id=1 AND t.updated_at>=w.started_at
      WHERE t.status IN ('completed','waiting_client','paused','needs_review') AND t.recovery_ready=FALSE
      AND NOT EXISTS (SELECT 1 FROM user_notifications n WHERE n.user_id=t.user_id AND n.source_key=CONCAT(t.id,':',t.status))
      ORDER BY t.updated_at,t.id LIMIT 256`)
    for (const row of rows) {
      // Recheck the exact state, including its timestamp, after the nonlocking scan.
      await this.source.query(`INSERT IGNORE INTO user_notifications(id,user_id,source_key,task_id,kind)
        SELECT ?,user_id,CONCAT(id,':',status),id,status FROM agent_tasks WHERE id=? AND status=? AND updated_at=? AND recovery_ready=FALSE`, [randomUUID(), row.id, row.status, row.updated_at])
    }
  }

  async list(actor: Actor) {
    await this.recover()
    const rows = await this.source.query('SELECT id,task_id,kind,read_at,created_at FROM user_notifications WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100', [actor.user.id])
    const [counts] = await this.source.query('SELECT COUNT(*) total FROM user_notifications WHERE user_id=? AND read_at IS NULL', [actor.user.id])
    return { unread: Number(counts.total), items: rows.map((row: any) => ({ id: row.id, taskId: row.task_id, title: labels[row.kind] || '任务状态已更新', read: !!row.read_at, createdAt: isoTime(row.created_at)! })) }
  }

  async read(actor: Actor, id?: string) {
    if (id) {
      const [owned] = await this.source.query('SELECT id FROM user_notifications WHERE id=? AND user_id=?', [id, actor.user.id])
      if (!owned) {
        throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', '通知不存在')
      }
    }
    await this.source.query(`UPDATE user_notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP(3)) WHERE user_id=?${id ? ' AND id=?' : ''}`, [actor.user.id, ...(id ? [id] : [])])
  }
}
