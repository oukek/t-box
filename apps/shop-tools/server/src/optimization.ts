import type { BackendInvocation } from '@t-box/app-contracts'
import type { OptimizationJob, ProjectPrompt } from '@t-box/shop-tools-contracts'
import type { DataSource, EntityManager } from 'typeorm'
import type { CreativeModel } from './creative.js'
import { fingerprint } from '@t-box/server-foundation/persistence/operations'
import { projectSites, ShopError } from '@t-box/shop-tools-contracts'
import { catalogMedia, optimizationContent, parseCatalogContent, projectPrompt, restoreCatalogMedia, selectOptimization } from '@t-box/shop-tools-core'
import { CatalogEntity, CollectionEntity, ProjectSiteEntity, VersionEntity } from './catalog-entities.js'
import { ShopOperationEntity, ShopWorkspaceEntity } from './entities.js'
import { OptimizationEntity, PromptEntity } from './optimization-entities.js'
import { authorize } from './projects.js'

const now = () => new Date().toISOString()
const defaults: Record<string, string> = { MY: '马来语', SG: '英语', TH: '泰语', TW: '繁体中文', ID: '印尼语', PH: '英语', VN: '越南语', BR: '葡萄牙语' }
export class OptimizationService {
  constructor(private source: DataSource, private models?: (r: BackendInvocation) => CreativeModel) {}
  private async current(db: EntityManager, r: BackendInvocation) {
    const row = await db.findOne(ShopWorkspaceEntity, { where: { subject: r.subject }, lock: { mode: 'pessimistic_read' } })
    if (!row?.active || row.generation !== r.generation || row.releaseId !== r.releaseId) {
      throw ShopError.installation()
    }
  }

  private async idle(db: EntityManager, project: string) {
    const active = await db.findBy(OptimizationEntity, { project, status: 'running' })
    if (active.some((j) => Date.now() - Date.parse(j.updatedAt) < 12 * 60000)) {
      throw ShopError.invalid('项目中已有优化任务正在运行，请等待完成后再开始')
    }
    for (const j of active) {
      j.status = 'finished'
      j.lease = crypto.randomUUID()
      for (const result of Object.values(j.results)) {
        if (result.status !== 'complete') {
          Object.assign(result, { status: 'failed', error: '任务中断，请重试未完成项' })
        }
      }
      await db.save(OptimizationEntity, j)
    }
  }

  private async settings(db: EntityManager, project: string): Promise<ProjectPrompt> {
    const saved = await db.findOneBy(PromptEntity, { project })
    const site = await db.findOneBy(ProjectSiteEntity, { project })
    return saved ? { language: saved.language, prompt: saved.prompt, revision: saved.revision } : { language: defaults[site?.site || ''] || '英语', prompt: '使用自然、简洁的当地语言，保持商品事实准确。图片统一清晰、干净的电商风格，保留商品颜色、形状、数量和规格，不虚构功能、认证或促销信息。', revision: 0 }
  }

  async file(r: BackendInvocation, project: string, product: string, fileId: string) {
    await this.source.transaction(async (db) => {
      await this.current(db, r)
      await authorize(db, r.subject, project, 'viewer')
      if (!await db.existsBy(CatalogEntity, { id: product, project })) {
        throw ShopError.denied()
      }
      const versions = await db.findBy(VersionEntity, { product })
      if (versions.some((v) => v.content.imageFileId === fileId || v.content.media?.some((a) => a.fileId === fileId))) {
        return
      }
      const jobs = await db.findBy(OptimizationEntity, { product, project })
      if (jobs.some((j) => Object.values(j.results).some((v) => v.fileId === fileId))) {
        return
      }
      throw ShopError.denied()
    })
  }

  async invoke(r: BackendInvocation) {
    const a = r.arguments as Record<string, unknown>
    const project = String(a.projectId || '')
    const action = String(a.action)
    // Resolve actor-bound provider synchronously, before background work leaves request scope.
    let model: CreativeModel | undefined
    if (['ai-start', 'ai-retry', 'ai-image'].includes(action)) {
      model = this.models?.(r)
    }
    let launch: OptimizationJob | undefined
    const response = await this.source.transaction(async (db) => {
      await this.current(db, r)
      await authorize(db, r.subject, project, ['ai-settings', 'ai-get', 'ai-list', 'ai-image'].includes(action) ? 'viewer' : 'editor')
      if (action === 'ai-settings') {
        return this.settings(db, project)
      }
      if (action === 'ai-save-settings') {
        const before = await this.settings(db, project)
        if (a.revision !== before.revision) {
          throw ShopError.conflict()
        }
        const next = projectPrompt(a.rules, before.revision + 1)
        await db.upsert(PromptEntity, { project, ...next }, ['project'])
        return next
      }
      const product = await db.findOneBy(CatalogEntity, { id: String(a.productId || ''), project })
      if (!product) {
        throw ShopError.denied()
      }
      if (action === 'ai-image') {
        return { fileId: String(a.fileId) }
      }
      if (action === 'ai-list') {
        return (await db.find(OptimizationEntity, { where: { project, product: product.id }, order: { createdAt: 'DESC' }, take: 10 })).map((j) => ({ id: j.id, status: j.status, createdAt: j.createdAt, appliedVersion: j.appliedVersion }))
      }
      if (action === 'ai-start') {
        const id = fingerprint(['shop-opt', r.subject, project, r.invocationId])
        const prior = await db.findOneBy(OptimizationEntity, { id })
        const key = fingerprint(['shop-opt-request', r.invocationId])
        const hash = fingerprint([r.generation, r.arguments])
        const operation = await db.findOneBy(ShopOperationEntity, { subject: r.subject, key })
        if (prior) {
          if (!operation || operation.hash !== hash) {
            throw ShopError.replay()
          }
          return { id }
        }
        if (!model?.catalogText || !model.catalogImage) {
          throw ShopError.invalid('整件商品优化服务尚未启用')
        }
        const version = await db.findOneBy(VersionEntity, { id: String(a.versionId), product: product.id })
        if (!version || version.revision !== a.revision) {
          throw ShopError.conflict()
        }
        const projectSite = await db.findOneBy(ProjectSiteEntity, { project })
        const site = projectSites.find((s) => s.value === projectSite?.site)
        if (!site) {
          throw ShopError.invalid('请先设置项目国家站点')
        }
        const settings = await this.settings(db, project)
        if (settings.revision !== a.rulesRevision) {
          throw ShopError.conflict()
        }
        const original = await db.findOneBy(CollectionEntity, { id: product.source })
        const content = restoreCatalogMedia(version.content, original?.data)
        content.media = catalogMedia(content)
        const slots = selectOptimization(content, a.choices)
        if (typeof a.supplement !== 'string' || a.supplement.length > 4000) {
          throw ShopError.invalid('补充要求过长')
        }
        await this.idle(db, project)
        launch = { id, project, subject: r.subject, product: product.id, status: 'running', lease: crypto.randomUUID(), createdAt: now(), updatedAt: now(), appliedVersion: null, snapshot: { source: content, sourceVersion: version.id, sourceRevision: version.revision, country: site.label, currency: site.currency, rules: settings, supplement: a.supplement, slots }, results: Object.fromEntries(slots.filter((s) => s.mode === 'optimize').map((s) => [s.id, { status: 'pending' }])) }
        await db.save(OptimizationEntity, launch)
        await db.insert(ShopOperationEntity, { subject: r.subject, key, hash, response: { id }, createdAt: new Date() })
        return { id }
      }
      const job = await db.findOne(OptimizationEntity, { where: { id: String(a.jobId), project, product: product.id }, lock: { mode: 'pessimistic_write' } })
      if (!job) {
        throw ShopError.denied()
      }
      if (job.status === 'running' && Date.now() - Date.parse(job.updatedAt) > 12 * 60000) {
        job.status = 'finished'
        job.lease = crypto.randomUUID()
        for (const result of Object.values(job.results)) {
          if (result.status !== 'complete') {
            Object.assign(result, { status: 'failed', error: '任务中断，请重试未完成项' })
          }
        }
        await db.save(OptimizationEntity, job)
      }
      if (action === 'ai-get') {
        return job
      }
      if (action === 'ai-retry') {
        if (job.appliedVersion || job.status === 'running') {
          return { id: job.id }
        }
        if (!model?.catalogText || !model.catalogImage) {
          throw ShopError.invalid('优化服务不可用')
        }
        await this.idle(db, project)
        const ids = a.ids
        if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || job.results[id]?.status !== 'failed')) {
          throw ShopError.invalid('只能重试失败项')
        }
        for (const id of new Set<string>(ids)) {
          job.results[id] = { status: 'pending' }
        }
        job.status = 'running'
        job.lease = crypto.randomUUID()
        job.updatedAt = now()
        await db.save(OptimizationEntity, job)
        launch = job
        return { id: job.id }
      }
      if (action === 'ai-apply') {
        if (job.appliedVersion) {
          return { id: job.appliedVersion }
        }
        if (job.status === 'running') {
          throw ShopError.invalid('任务尚未完成')
        }
        const versionCount = await db.countBy(VersionEntity, { product: product.id })
        if (versionCount >= 30) {
          throw ShopError.invalid('每件商品最多保留 30 个版本')
        }
        const content = parseCatalogContent(optimizationContent(job, a.edits), job.snapshot.currency)
        for (const sku of content.skus) {
          sku.pricing = job.snapshot.source.skus.find((s) => s.id === sku.id)!.pricing
        }
        const id = fingerprint(['shop-opt-version', job.id])
        await db.save(VersionEntity, { id, product: product.id, name: `AI 优化版 ${versionCount + 1}`, revision: 0, content, createdAt: now() })
        job.appliedVersion = id
        await db.save(OptimizationEntity, job)
        await db.update(CatalogEntity, { id: product.id }, { modified: true, title: content.title })
        return { id }
      }
      throw ShopError.invalid('优化操作无效')
    })
    if (action === 'ai-image') {
      const id = String(a.fileId)
      if (!model?.catalogPreview) {
        throw ShopError.invalid('图片预览暂不可用')
      }
      return model.catalogPreview(id, () => this.file(r, project, String(a.productId), id))
    }
    if (launch && model) {
      void this.run(r, launch, model).catch(() => console.error('SHOP_OPTIMIZATION_INTERRUPTED', launch!.id))
    }
    return response
  }

  private async run(r: BackendInvocation, job: OptimizationJob, model: CreativeModel) {
    const repo = this.source.getRepository(OptimizationEntity)
    const persist = async () => {
      job.updatedAt = now()
      const written = await repo.update({ id: job.id, lease: job.lease }, { results: job.results, status: job.status, updatedAt: job.updatedAt })
      if (!written.affected) {
        throw ShopError.conflict()
      }
    }
    const pending = job.snapshot.slots.filter((s) => job.results[s.id]?.status === 'pending')
    // Text is bounded into batches;
    // each image keeps an independent result and retry boundary.
    const text = pending.filter((s) => s.kind === 'text')
    const groups = []
    for (let i = 0; i < text.length; i += 20) {
      groups.push(text.slice(i, i + 20))
    }
    groups.push(...pending.filter((s) => s.kind === 'image').map((s) => [s]))
    for (const slots of groups) {
      await this.source.transaction(async (db) => {
        await this.current(db, r)
        await authorize(db, r.subject, job.project, 'editor')
      })
      for (const slot of slots) {
        job.results[slot.id] = { status: 'running' }
      }
      await persist()
      try {
        const signal = AbortSignal.timeout(10 * 60000)
        const input = { snapshot: job.snapshot, slots }
        if (slots[0]!.kind === 'image') {
          const slot = slots[0]!
          const fileId = await model.catalogImage!(input, slot.asset!, signal, (id) => this.file(r, job.project, job.product, id))
          if (typeof fileId !== 'string' || !fileId || fileId.length > 80) {
            throw ShopError.invalid('模型未返回有效图片')
          }
          job.results[slot.id] = { status: 'complete', fileId }
        } else {
          const result = await model.catalogText!(input, signal)
          if (Object.keys(result).length !== slots.length || slots.some((s) => typeof result[s.id] !== 'string' || (s.id !== 'description' && !result[s.id]!.trim()) || result[s.id]!.length > (s.id === 'description' ? 100000 : 1000))) {
            throw ShopError.invalid('模型返回的文字标识或内容不完整')
          }
          for (const slot of slots) {
            job.results[slot.id] = { status: 'complete', text: result[slot.id] }
          }
        }
      } catch (e) {
        for (const slot of slots) {
          job.results[slot.id] = { status: 'failed', error: e instanceof Error ? e.message.slice(0, 200) : '优化失败，请重试' }
        }
      }
      await persist()
    }
    job.status = 'finished'
    await persist()
  }
}
