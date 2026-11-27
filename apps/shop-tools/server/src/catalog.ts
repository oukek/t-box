import type { BackendInvocation } from '@t-box/app-contracts'
import type { CatalogContent, CollectedProduct } from '@t-box/shop-tools-contracts'
import type { DataSource, EntityManager } from 'typeorm'
import { fingerprint } from '@t-box/server-foundation/persistence/operations'
import { projectSites, ShopError } from '@t-box/shop-tools-contracts'
import { parseCatalogContent, parseCollected, parseTemplates } from '@t-box/shop-tools-core'
import { AssistantSettingsEntity, CatalogEntity, CollectionEntity, ProjectSiteEntity, VersionEntity } from './catalog-entities.js'
import { CreativeEntity, ShopWorkspaceEntity } from './entities.js'
import { authorize } from './projects.js'

export class ShopCatalog {
  constructor(private readonly source: DataSource) {}
  async collect(subject: string, value: unknown) {
    if (!Array.isArray(value) || !value.length || value.length > 20 || JSON.stringify(value).length > 1500000) {
      throw ShopError.invalid('每批最多确认 20 件商品，资料不超过 1.5 MB')
    }
    const items = value.map(parseCollected)
    const result: string[] = []
    // Stable account/source IDs make unknown-response retries safe; original snapshots never overwrite claims.
    await this.source.transaction(async (db) => {
      for (const data of items) {
        const id = fingerprint(['collected', subject, data.platform, data.sourceId || data.sourceUrl || data.id])
        await db.createQueryBuilder().insert().into(CollectionEntity).values({ id, subject, data, createdAt: new Date().toISOString() }).orIgnore().execute()
        result.push(id)
      }
    })
    return { ids: result, count: result.length }
  }

  async invoke(db: EntityManager, r: BackendInvocation) {
    const a = (r.arguments || {}) as { action: string, offset?: number, projectId: string, site: string, ids: string[], id: string, versionId: string, revision: number, name: string, content: unknown, creationId?: string, templates: unknown }
    if (a.action === 'templates') {
      return (await db.findOneBy(AssistantSettingsEntity, { subject: r.subject }))?.templates ?? (await db.findOneBy(ShopWorkspaceEntity, { subject: r.subject }))?.config?.creativeTemplates ?? []
    }
    if (a.action === 'save-templates') {
      await db.upsert(AssistantSettingsEntity, { subject: r.subject, templates: parseTemplates(a.templates) }, ['subject'])
      return { ok: true }
    }
    if (a.action === 'collection') {
      const offset = Number(a.offset || 0)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
        throw ShopError.invalid('分页参数无效')
      }
      const rows = await db.find(CollectionEntity, { where: { subject: r.subject }, order: { createdAt: 'DESC', id: 'ASC' }, skip: offset, take: 20 })
      return { items: rows, nextOffset: rows.length === 20 ? offset + 20 : null }
    }
    const member = await authorize(db, r.subject, a.projectId, ['list', 'get', 'site'].includes(a.action) ? 'viewer' : a.action === 'set-site' ? 'admin' : 'editor')
    const project = member.project
    const setting = await db.findOneBy(ProjectSiteEntity, { project })
    if (a.action === 'site') {
      return setting
    }
    if (a.action === 'set-site') {
      if (!projectSites.some((s) => s.value === a.site)) {
        throw ShopError.invalid('请选择项目国家站点')
      }
      if (setting && setting.site !== a.site && await db.existsBy(CatalogEntity, { project })) {
        throw ShopError.invalid('项目已有商品，不能更换站点；请新建项目')
      }
      await db.upsert(ProjectSiteEntity, { project, site: a.site }, ['project'])
      return { site: a.site }
    }
    if (a.action === 'list') {
      const offset = Number(a.offset || 0)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
        throw ShopError.invalid('分页参数无效')
      }
      const items = await db.find(CatalogEntity, { where: { project }, order: { createdAt: 'DESC', id: 'ASC' }, skip: offset, take: 30 })
      return { items, nextOffset: items.length === 30 ? offset + 30 : null }
    }
    if (a.action === 'claimed') {
      if (!Array.isArray(a.ids) || a.ids.length > 20) {
        throw ShopError.invalid('认领选择无效')
      }
      const claimed: string[] = []
      for (const source of a.ids) {
        if (typeof source === 'string' && await db.existsBy(CatalogEntity, { project, source })) {
          claimed.push(source)
        }
      }
      return claimed
    }
    const site = projectSites.find((s) => s.value === setting?.site)
    if (a.action === 'claim') {
      if (!site) {
        throw ShopError.invalid('先在项目设置中选择国家站点')
      }
      if (!Array.isArray(a.ids) || !a.ids.length || a.ids.length > 20) {
        throw ShopError.invalid('每次最多认领 20 件商品')
      }
      for (const source of new Set(a.ids)) {
        if (typeof source !== 'string') {
          throw ShopError.invalid('商品标识无效')
        }
        const rec = await db.findOneBy(CollectionEntity, { id: source, subject: r.subject })
        if (!rec) {
          throw ShopError.denied()
        }
        const id = fingerprint(['claim', project, source])
        if (await db.existsBy(CatalogEntity, { id })) {
          continue
        }
        const content = this.initial(rec.data, site.currency)
        const createdAt = new Date().toISOString()
        await db.insert(CatalogEntity, { id, project, source, title: content.title, modified: false, createdAt })
        await db.save(VersionEntity, { id: fingerprint(['initial', id]), product: id, name: '初始版本', revision: 0, content, createdAt })
      }
      return { ok: true }
    }
    if (typeof a.id !== 'string') {
      throw ShopError.invalid('商品标识无效')
    }
    const product = await db.findOneBy(CatalogEntity, { id: a.id, project })
    if (!product) {
      throw ShopError.denied()
    }
    if (a.action === 'get') {
      return { product, versions: await db.find(VersionEntity, { where: { product: product.id }, order: { createdAt: 'ASC', id: 'ASC' } }) }
    }
    if (!site) {
      throw ShopError.invalid('请配置项目站点')
    }
    if (!['save', 'version'].includes(a.action)) {
      throw ShopError.invalid('商品操作无效')
    }
    if (typeof a.versionId !== 'string') {
      throw ShopError.invalid('版本标识无效')
    }
    const version = await db.findOne(VersionEntity, { where: { id: a.versionId, product: product.id }, lock: { mode: 'pessimistic_write' } })
    if (!version || version.revision !== a.revision) {
      throw ShopError.conflict()
    }
    if (a.action === 'version') {
      const id = fingerprint(['catalog-version', product.id, r.invocationId])
      if (await db.existsBy(VersionEntity, { id })) {
        return { id }
      }
      const content = structuredClone(version.content)
      if (a.creationId) {
        const creation = await db.findOneBy(CreativeEntity, { id: String(a.creationId), subject: r.subject, project })
        if (!creation || creation.status !== 'finished' || creation.errors.length) {
          throw ShopError.invalid('AI 生成尚未完成或有错误')
        }
        content.title = creation.output.title || content.title
        content.description = creation.output.description || content.description
        if (creation.output.image) {
          content.imageFileId = creation.output.image
        }
      }
      if (await db.countBy(VersionEntity, { product: product.id }) >= 30) {
        throw ShopError.invalid('每件商品最多保留 30 个版本')
      }
      await db.save(VersionEntity, { id, product: product.id, name: a.creationId ? 'AI 优化版' : '人工副本', revision: 0, content: parseCatalogContent(content, site.currency), createdAt: new Date().toISOString() })
      await db.update(CatalogEntity, { id: product.id }, { modified: true })
      return { id }
    }
    const content = parseCatalogContent(a.content, site.currency)
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80) {
      throw ShopError.invalid('版本名称无效')
    }
    await db.save(VersionEntity, { ...version, content, name: a.name, revision: version.revision + 1 })
    await db.update(CatalogEntity, { id: product.id }, { title: content.title, modified: true })
    return { revision: version.revision + 1 }
  }

  private initial(data: CollectedProduct, currency: string): CatalogContent {
    const sources = data.variants.length ? data.variants : [{ id: '', sku: '', attributes: [], price: data.price.amount, currency: data.price.currency, images: [] }]
    return { title: data.title, description: data.description, images: data.assets.filter((a) => a.role === 'main' || a.role === 'detail').map((a) => a.url), skus: sources.map((s) => ({ id: crypto.randomUUID(), code: s.sku, name: s.attributes.map((a) => `${a.name}: ${a.value}`).join(' / ') || '默认规格', sourceSkuId: s.id || null, cost: s.currency === 'CNY' && s.price !== null && Number.isFinite(Number(s.price)) && Number(s.price) >= 0 ? Number(s.price) : null, currency, price: null, pricing: null })) }
  }
}
