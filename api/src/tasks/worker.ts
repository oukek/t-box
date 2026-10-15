import type { ChatService } from '../chat/engine.js'
import type { TaskStore } from './store.js'
import { randomUUID } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'

/** A bounded scheduler; MySQL reservations and execution leases arbitrate all processes. */
export class TaskRecoveryWorker {
  private timer?: ReturnType<typeof setInterval>
  private readonly jobs = new Set<Promise<void>>()
  private stopped = false
  private sweep?: Promise<void>
  constructor(
    private readonly tasks: TaskStore,
    private readonly chat: Pick<ChatService, 'resumeInBackground'>,
    private readonly concurrency: () => Promise<number> = async () => 2,
    private readonly log: (code: string, taskId?: string) => void = () => {},
  ) {}

  start() {
    this.timer ??= setInterval(
      () =>
        void this.tick().catch(() => this.log('TASK_RECOVERY_SWEEP_FAILED')),
      2000,
    )
    void this.tick().catch(() => this.log('TASK_RECOVERY_SWEEP_FAILED'))
  }

  tick(): Promise<void> {
    if (this.sweep) {
      return this.sweep
    }
    this.sweep = this.fill().finally(() => (this.sweep = undefined))
    return this.sweep
  }

  private async fill() {
    const concurrency = Math.max(1, Math.min(32, await this.concurrency()))
    while (!this.stopped && this.jobs.size < concurrency) {
      const claim = randomUUID()
      const task = await this.tasks.takeRecovery(claim)
      if (!task) {
        return
      }
      const job = this.chat
        .resumeInBackground(task, claim)
        .catch(async (error) => {
          const code =
            error instanceof ApiError ? error.code : 'TASK_RECOVERY_FAILED'
          const waiting =
            error instanceof ApiError &&
            [401, 403, 423].includes(error.statusCode)
          await this.tasks.stopRecovery(
            task.id,
            claim,
            waiting,
            error instanceof ApiError
              ? `${error.message}${waiting ? '；请打开所属会话处理后继续' : ''}`
              : '后台恢复失败，请打开会话核对后继续',
          )
          this.log(code, task.id)
        })
        .catch(() => this.log('TASK_RECOVERY_STATE_FAILED'))
      this.jobs.add(job)
      void job.finally(() => this.jobs.delete(job))
    }
  }

  async stopScheduling() {
    this.stopped = true
    clearInterval(this.timer)
    await this.sweep
  }

  async drain() {
    await Promise.allSettled(this.jobs)
  }
}
