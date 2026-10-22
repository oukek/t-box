import type { CareInput, CarePage, CareRecord } from '@t-box/baby-diary-contracts/care'
import { BabyErrorCode } from '@t-box/baby-diary-contracts'

export interface CareCommand {
  key: string
  action: 'add' | 'update' | 'delete' | 'restore'
  target: string
  revision: number
  record?: CareInput
  at: string
  error?: string
}
export interface CareSnapshot {
  version: 1
  records: CareRecord[]
  pending: CareCommand[]
  from: string
  to: string
  asOf: string
}
export interface CareOutboxPort {
  babyId: string
  subject: string
  name: string
  save(snapshot: CareSnapshot): Promise<void>
  invoke(method: string, args: unknown, key: string): Promise<CareRecord | CareRecord[]>
  changed(snapshot: CareSnapshot): void
}
export const emptyCareSnapshot = (): CareSnapshot => ({ version: 1, records: [], pending: [], from: '', to: '', asOf: '' })
export function carePreview(snapshot: CareSnapshot, babyId: string, subject: string, name: string): CareRecord[] {
  const records = new Map(snapshot.records.map((record) => [record.id, record]))
  for (const command of snapshot.pending) {
    const previous = records.get(command.target)
    if (command.action === 'add' && command.record) {
      records.set(command.target, { ...command.record, id: command.target, babyId, author: subject, authorName: name, revision: 1, createdAt: command.at, updatedAt: command.at, deletedAt: null })
    } else if (previous) {
      records.set(command.target, { ...previous, ...(command.record ?? {}), revision: previous.revision + 1, updatedAt: command.at, deletedAt: command.action === 'delete' ? command.at : command.action === 'restore' ? null : previous.deletedAt })
    }
  }
  return [...records.values()]
}
/**
 * Durable commands keep their original idempotency keys after timeouts and reloads.
 * Network I/O never holds the local write lock, so a second quick record stays responsive.
 */
export class CareOutbox {
  private snapshot: CareSnapshot
  private serial = Promise.resolve()
  private flushing?: Promise<void>
  private closed = false
  constructor(readonly port: CareOutboxPort, initial = emptyCareSnapshot()) {
    this.snapshot = structuredClone(initial)
    port.changed(this.snapshot)
  }

  private write(work: (snapshot: CareSnapshot) => CareSnapshot): Promise<void> {
    const operation = this.serial.then(async () => {
      if (this.closed) {
        return
      }
      const next = work(structuredClone(this.snapshot))
      const targets = new Set(next.pending.map((command) => command.target))
      // Cloud cache is expendable; never reject a quick record merely because old cache fills the quota.
      while (JSON.stringify(next).length > 60_000) {
        let index = next.records.length - 1
        while (index >= 0 && (next.records[index]!.state !== 'completed' || targets.has(next.records[index]!.id))) {
          index--
        }
        if (index < 0) {
          break
        }
        next.records.splice(index, 1)
        next.asOf = ''
      }
      if (next.pending.length > 30 || JSON.stringify(next).length > 60_000) {
        throw BabyErrorCode.BABY_INVALID_INPUT('本机待同步内容已满，请联网同步后继续')
      }
      await this.port.save(next)
      this.snapshot = next
      if (!this.closed) {
        this.port.changed(next)
      }
    })
    this.serial = operation.catch(() => {})
    return operation
  }

  async enqueue(command: CareCommand) {
    await this.write((state) => ({ ...state, pending: [...state.pending, command] }))
  }

  async accept(page: CarePage, from: string, to: string) {
    await this.write((state) => {
      const targets = new Set(state.pending.map((command) => command.target))
      const candidates = [...new Map([...page.records, ...state.records.filter((row) => targets.has(row.id) && !page.records.some((remote) => remote.id === row.id))].map((row) => [row.id, row])).values()]
      candidates.sort((a, b) => Number(targets.has(b.id) || b.state !== 'completed') - Number(targets.has(a.id) || a.state !== 'completed') || b.occurredAt.localeCompare(a.occurredAt))
      const records: CareRecord[] = []
      let bytes = JSON.stringify(state.pending).length + 500
      for (const row of candidates) {
        const size = JSON.stringify(row).length + 1
        if (bytes + size > 58_000 || records.length >= 80) {
          break
        }
        records.push(row)
        bytes += size
      }
      return { ...state, records, from, to, asOf: records.length >= page.records.length ? page.asOf : '' }
    })
  }

  async discard(key: string) {
    await this.write((state) => {
      const item = state.pending.find((command) => command.key === key)
      // Later changes to the same record depend on this draft's revision and must be discarded together.
      return { ...state, pending: state.pending.filter((command) => command.key !== key && command.target !== item?.target) }
    })
  }

  async retry() {
    await this.write((state) => ({ ...state, pending: state.pending.map((command) => ({ ...command, error: undefined })) }))
  }

  close() {
    this.closed = true
  }

  flush(): Promise<void> {
    this.flushing ??= this.drain().finally(() => {
      this.flushing = undefined
    })
    return this.flushing
  }

  private async drain() {
    await this.serial
    let firstFailure: unknown
    while (!this.closed) {
      const blocked = new Set(this.snapshot.pending.filter((item) => item.error).map((item) => item.target))
      const command = this.snapshot.pending.find((item) => !blocked.has(item.target))
      if (!command) {
        if (firstFailure) {
          throw firstFailure
        }
        return
      }
      try {
        const args = command.action === 'add'
          ? { babyId: this.port.babyId, records: [command.record] }
          : { babyId: this.port.babyId, id: command.target, revision: command.revision, ...(command.action === 'update' ? { record: command.record } : {}) }
        const result = await this.port.invoke(`care_${command.action}`, args, command.key)
        if (this.closed) {
          return
        }
        const record = Array.isArray(result) ? result[0]! : result
        await this.write((state) => ({
          ...state,
          records: [record, ...state.records.filter((row) => row.id !== record.id && row.id !== command.target)].slice(0, 80),
          pending: state.pending.filter((item) => item.key !== command.key).map((item) => item.target === command.target ? { ...item, target: record.id } : item),
        }))
      } catch (error) {
        const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          await this.write((state) => ({ ...state, pending: state.pending.map((item) => item.key === command.key ? { ...item, error: error instanceof Error ? error.message : '同步失败，请核对权限或记录状态' } : item) }))
          firstFailure ??= error
        } else {
          throw error
        }
      }
      await this.serial
    }
  }
}
