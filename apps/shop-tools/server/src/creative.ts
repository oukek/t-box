import type { BackendInvocation } from '@t-box/app-contracts'
import type { Creation, CreativeInput } from '@t-box/shop-tools-contracts'
import type { DataSource } from 'typeorm'
import { fingerprint } from '@t-box/server-foundation/persistence/operations'
import { ShopError } from '@t-box/shop-tools-contracts'
import { parseCreativeInput } from '@t-box/shop-tools-core'
import { CreativeEntity } from './entities.js'
import { authorize } from './projects.js'

export interface CreativeModel {
  text(input: CreativeInput, signal: AbortSignal): Promise<Partial<Record<'title' | 'description', string>>>
  image(input: CreativeInput, signal: AbortSignal): Promise<string>
}
export class CreativeService {
  private readonly ephemeral = new Map<string, { subject: string, expires: number, record: Creation }>()
  async temporary(r: BackendInvocation) {
    const args = r.arguments as Record<string, unknown>
    for (const [id, item] of this.ephemeral) {
      if (item.expires < Date.now()) {
        this.ephemeral.delete(id)
      }
    }
    if (args.action === 'history') {
      return [...this.ephemeral.values()].filter((x) => x.subject === r.subject).map(({ record }) => ({ ...record, title: record.input.title, language: record.input.rules.language }))
    }
    if (args.action === 'get') {
      const entry = this.ephemeral.get(String(args.id))
      return entry?.subject === r.subject ? entry.record : null
    }
    if (args.action !== 'create' || !this.model) {
      throw ShopError.invalid('创作服务不可用')
    }
    const input = parseCreativeInput(args.input)
    const id = fingerprint(['temporary', r.subject, r.invocationId])
    const prior = this.ephemeral.get(id)
    if (prior) {
      if (fingerprint(prior.record.input) !== fingerprint(input)) {
        throw ShopError.replay()
      }
      return { id }
    }
    if (this.ephemeral.size >= 200) {
      throw ShopError.invalid('临时创作任务繁忙，请稍后重试')
    }
    const record: Creation = { id, input, output: {}, status: 'running', errors: [], createdAt: new Date().toISOString() }
    this.ephemeral.set(id, { subject: r.subject, expires: Date.now() + 30 * 60000, record })
    void this.generate(record, this.model(r), false).catch(() => {
      record.errors.push('任务中断')
      record.status = 'finished'
    })
    return { id }
  }

  constructor(private source: DataSource, private model?: (r: BackendInvocation) => CreativeModel) {}

  async invoke(r: BackendInvocation, project: string) {
    const args = r.arguments as Record<string, unknown>
    const scope = { subject: r.subject, project }
    const repo = this.source.getRepository(CreativeEntity)
    if (args.action === 'history' || args.action === 'get') {
      const rows = await repo.find({ where: args.action === 'get' ? { ...scope, id: String(args.id) } : scope, order: { createdAt: 'DESC' }, take: 30 })
      const records = rows.map(({ id, input, output, status, errors, createdAt }) => {
        if (status === 'running' && Date.now() - Date.parse(createdAt) > 12 * 60000) {
          return { id, input, output, createdAt, status: 'finished', errors: [...errors, '任务中断，请重新创作'] }
        }
        return { id, input, output, status, errors, createdAt }
      })
      if (args.action === 'get') {
        return records[0] ?? null
      }
      return records.map(({ id, input, status, errors, createdAt }) => ({ id, title: (input.title || input.description || '商品图片').slice(0, 100), language: input.rules.language, status, errors, createdAt }))
    }
    if (args.action !== 'create' || !this.model) {
      throw ShopError.invalid('创作服务不可用')
    }
    const input = parseCreativeInput(args.input)
    const id = fingerprint([project, r.subject, r.invocationId])
    const entry: Creation = { id, input, output: {}, status: 'running', errors: [], createdAt: new Date().toISOString() }
    const model = this.model(r)
    const inserted = await this.source.transaction(async (db) => {
      // Serialize retries for the same project, including requests with an unknown acknowledgement.
      await authorize(db, r.subject, project, 'editor')
      const prior = await db.findOneBy(CreativeEntity, { id })
      if (prior) {
        if (fingerprint(prior.input) !== fingerprint(input)) {
          throw ShopError.replay()
        }
        return false
      }
      await db.insert(CreativeEntity, { ...scope, ...entry })
      return true
    })
    if (inserted) {
      void this.generate(entry, model).catch(() => console.error('SHOP_CREATION_SAVE_FAILED', id))
    }
    return { id }
  }

  private async generate(entry: Creation, model: CreativeModel, persist = true) {
    const repo = this.source.getRepository(CreativeEntity)
    const signal = AbortSignal.timeout(10 * 60000)
    const operations: [string, () => Promise<Creation['output']>][] = []
    if (entry.input.fields.some((f) => f !== 'image')) {
      operations.push(['文案', () => model.text(entry.input, signal)])
    }
    if (entry.input.fields.includes('image')) {
      operations.push(['图片', async () => ({ image: await model.image(entry.input, signal) })])
    }
    for (const [label, run] of operations) {
      try {
        Object.assign(entry.output, await run())
      } catch (e) {
        entry.errors.push(label + '生成失败，' + (e instanceof Error ? e.message.slice(0, 200) : '请重试'))
      }
      if (persist) {
        await repo.update(entry.id, { output: entry.output, errors: entry.errors })
      }
    }
    if (persist) {
      await repo.update(entry.id, { status: 'finished' })
    }
  }
}
