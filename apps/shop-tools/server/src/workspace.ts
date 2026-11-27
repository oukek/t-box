import type { BackendInvocation, LifecycleRequest } from '@t-box/app-contracts'
import type { ApplicationBackend } from '@t-box/app-server-sdk'
import type { ProductPage, WorkspaceHeader } from '@t-box/shop-tools-contracts'
import type { DataSource, EntityManager } from 'typeorm'
import type { CreativeModel } from './creative.js'
import { fingerprint } from '@t-box/server-foundation/persistence/operations'
import { ShopError } from '@t-box/shop-tools-contracts'
import { validatePatch } from '@t-box/shop-tools-core'
import { In } from 'typeorm'
import { ShopCatalog } from './catalog.js'
import { CreativeService } from './creative.js'
import { createDataService } from './data.js'
import {
  ShopOperationEntity,
  ShopProductEntity,
  ShopWorkspaceEntity,
} from './entities.js'

import { authorize, projects } from './projects.js'

function binding(r: {
  appId: string
  subject: string
  generation: number
  releaseId: string
}) {
  if (
    r.appId !== 'shop-tools' ||
    typeof r.subject !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r.subject) ||
    !Number.isSafeInteger(r.generation) ||
    r.generation < 1 ||
    typeof r.releaseId !== 'string' ||
    !r.releaseId ||
    r.releaseId.length > 80
  ) {
    throw ShopError.installation()
  }
}
function invocationKey(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 100) {
    throw ShopError.invalid('保存标识无效')
  }
}
export class ShopToolsService {
  private readonly data = createDataService()
  private readonly creative: CreativeService
  constructor(private readonly source: DataSource, models?: (r: BackendInvocation) => CreativeModel) {
    this.creative = new CreativeService(source, models)
  }

  private async current(
    db: EntityManager,
    r: BackendInvocation,
    lock: 'pessimistic_read' | 'pessimistic_write',
  ) {
    binding(r)
    const row = await db
      .getRepository(ShopWorkspaceEntity)
      .findOne({ where: { subject: r.subject }, lock: { mode: lock } })
    if (
      !row?.active ||
      row.generation !== r.generation ||
      row.releaseId !== r.releaseId
    ) {
      throw ShopError.installation()
    }
    return row
  }

  async lifecycle(r: LifecycleRequest) {
    binding(r)
    invocationKey(r.operationId)
    if (!['install', 'update', 'uninstall'].includes(r.action)) {
      throw ShopError.installation()
    }
    const response = await this.source.transaction(async (db) => {
      const repo = db.getRepository(ShopWorkspaceEntity)
      await repo
        .createQueryBuilder()
        .insert()
        .values({
          subject: r.subject,
          generation: r.generation,
          releaseId: r.releaseId,
          active: r.action !== 'uninstall',
          revision: 0,
          metadata: null,
          config: null,
          history: null,
          updatedAt: new Date(),
        })
        .orIgnore()
        .execute()
      const current = await repo.findOneOrFail({
        where: { subject: r.subject },
        lock: { mode: 'pessimistic_write' },
      })
      const key = fingerprint(['lifecycle', r.operationId])
      const hash = fingerprint(r)
      const prior = await db
        .getRepository(ShopOperationEntity)
        .findOneBy({ subject: r.subject, key })
      if (prior) {
        if (prior.hash !== hash) {
          throw ShopError.replay()
        }
        return prior.response
      }
      if (
        current.generation > r.generation ||
        (current.generation === r.generation &&
          ((!current.active && r.action !== 'uninstall') ||
            (current.releaseId !== r.releaseId && r.action !== 'update'))) ||
            (r.generation > current.generation && r.action !== 'install')
      ) {
        throw ShopError.installation()
      }
      await repo.update(
        { subject: r.subject },
        {
          generation: r.generation,
          releaseId: r.releaseId,
          active: r.action !== 'uninstall',
          updatedAt: new Date(),
        },
      )
      const response = {
        appId: r.appId,
        generation: r.generation,
        action: r.action,
      }
      await db.getRepository(ShopOperationEntity).insert({
        subject: r.subject,
        key,
        hash,
        response,
        createdAt: new Date(),
      })
      return response
    })
    return { status: 'completed' as const, receipt: response }
  }

  backend(): ApplicationBackend {
    return {
      lifecycle: (r) => this.lifecycle(r),
      operation: async (r) => {
        binding(r)
        invocationKey(r.operationId)
        const old = await this.source
          .getRepository(ShopOperationEntity)
          .findOneBy({
            subject: r.subject,
            key: fingerprint(['lifecycle', r.operationId]),
          })
        if (!old) {
          return null
        }
        if (old.hash !== fingerprint(r)) {
          throw ShopError.replay()
        }
        return { status: 'completed', receipt: old.response }
      },
      invoke: (r, signal) => this.invoke(r, signal),
    }
  }

  private async workspace(db: EntityManager, r: BackendInvocation, write = false) {
    const lock = write ? 'pessimistic_write' : 'pessimistic_read'
    const personal = await this.current(db, r, lock)
    const id = (r.arguments as { projectId?: unknown } | null)?.projectId
    if (id === undefined) {
      return personal
    }
    const member = await authorize(db, r.subject, id, write ? 'editor' : 'viewer')
    if (member.project === personal.subject) {
      return personal
    }
    return db.findOneOrFail(ShopWorkspaceEntity, { where: { subject: member.project }, lock: { mode: lock } })
  }

  async invoke(r: BackendInvocation, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted()
    if (r.method === 'catalog') {
      invocationKey(r.invocationId)
      return this.source.transaction(async (db) => {
        await this.current(db, r, 'pessimistic_write')
        return new ShopCatalog(this.source).invoke(db, r)
      })
    }
    if (r.method === 'creative') {
      invocationKey(r.invocationId)
      const args = (r.arguments || {}) as Record<string, unknown>
      if (args.temporary === true) {
        await this.source.transaction((db) => this.current(db, r, 'pessimistic_read'))
        return this.creative.temporary(r)
      }
      const project = await this.source.transaction(async (db) => {
        await this.current(db, r, 'pessimistic_read')
        return (await authorize(db, r.subject, args.projectId, ['history', 'get'].includes(String(args.action)) ? 'viewer' : 'editor')).project
      })
      return this.creative.invoke(r, project)
    }
    if (r.method === 'projects') {
      invocationKey(r.invocationId)
      return this.source.transaction(async (db) => {
        await this.current(db, r, 'pessimistic_write')
        return projects(db, r)
      })
    }
    if (r.method === 'workspace_patch') {
      return this.patch(r)
    }
    if (r.method === 'workspace_get') {
      return this.source.transaction(async (db) => {
        const row = await this.workspace(db, r)
        return {
          revision: row.revision,
          metadata: row.metadata,
          config: row.config,
          history: row.history,
        } satisfies WorkspaceHeader
      })
    }
    if (r.method === 'workspace_rows') {
      return this.source.transaction(async (db) => {
        const row = await this.workspace(db, r)
        const args = r.arguments as { revision?: unknown, offset?: unknown }
        if (
          !args ||
          !Number.isSafeInteger(args.revision) ||
          !Number.isSafeInteger(args.offset) ||
          Number(args.offset) < 0 ||
          Number(args.offset) > 20000
        ) {
          throw ShopError.invalid('商品分页参数无效')
        }
        if (args.revision !== row.revision) {
          throw ShopError.conflict()
        }
        const records = await db.getRepository(ShopProductEntity).find({
          select: { sheetId: true, id: true, position: true, data: true },
          where: { subject: row.subject },
          order: { sheetId: 'ASC', position: 'ASC', id: 'ASC' },
          skip: Number(args.offset),
          take: 50,
        })
        const items: ProductPage['items'] = []
        let size = 0
        for (const rec of records) {
          const item = {
            sheetId: rec.sheetId,
            position: rec.position,
            row: rec.data,
          }
          const length = new TextEncoder().encode(
            JSON.stringify(item),
          ).byteLength
          if (items.length && size + length > 500000) {
            break
          }
          size += length
          items.push(item)
        }
        return {
          items,
          nextOffset:
            items.length === records.length && records.length < 50
              ? null
              : Number(args.offset) + items.length,
        } satisfies ProductPage
      })
    }
    await this.source.transaction((db) =>
      this.current(db, r, 'pessimistic_read'),
    )
    return this.data.invoke(r.method, r.arguments, signal)
  }

  private async patch(r: BackendInvocation) {
    invocationKey(r.invocationId)
    const { projectId: _project, ...patch } = (r.arguments || {}) as Record<string, unknown>
    const input = validatePatch(patch)
    return this.source.transaction(async (db) => {
      const current = await this.workspace(db, r, true)
      const key = fingerprint(['workspace_patch', r.invocationId])
      const hash = fingerprint([r.generation, r.releaseId, r.arguments])
      const old = await db
        .getRepository(ShopOperationEntity)
        .findOneBy({ subject: r.subject, key })
      if (old) {
        if (old.hash !== hash) {
          throw ShopError.replay()
        }
        return old.response
      }
      if (input.revision !== current.revision) {
        throw ShopError.conflict()
      }
      const metadata = input.metadata ?? current.metadata
      const config = input.config ?? current.config
      if (!metadata || !config) {
        throw ShopError.invalid('首次保存需要完整的工作表设置和默认配置')
      }
      const ids = new Set(metadata.sheets.map((s) => s.id))
      if (
        input.upserts.some((p) => !ids.has(p.sheetId)) ||
        input.removals.some((p) => !ids.has(p.sheetId))
      ) {
        throw ShopError.invalid('商品所属工作表不存在')
      }
      const products = db.getRepository(ShopProductEntity)
      const removed =
        current.metadata?.sheets
          .filter((s) => !ids.has(s.id))
          .map((s) => s.id) ?? []
      if (removed.length) {
        await products.delete({ subject: current.subject, sheetId: In(removed) })
      }
      if (input.removals.length) {
        await products.delete(
          input.removals.map((p) => ({
            subject: current.subject,
            sheetId: p.sheetId,
            id: p.id,
          })),
        )
      }
      if (input.upserts.length) {
        await products.upsert(
          input.upserts.map((p) => ({
            subject: current.subject,
            sheetId: p.sheetId,
            id: p.row.id,
            position: p.position,
            data: p.row,
          })),
          ['subject', 'sheetId', 'id'],
        )
      }
      for (const id of new Set(input.upserts.map((p) => p.sheetId))) {
        if (
          (await products.countBy({ subject: current.subject, sheetId: id })) > 1000
        ) {
          throw ShopError.invalid('每个工作表最多1000行商品')
        }
      }
      const revision = current.revision + 1
      await db.getRepository(ShopWorkspaceEntity).save({
        ...current,
        revision,
        metadata,
        config,
        history: input.history ?? current.history,
        updatedAt: new Date(),
      })
      const response = { revision }
      await db.getRepository(ShopOperationEntity).insert({
        subject: r.subject,
        key,
        hash,
        response,
        createdAt: new Date(),
      })
      return response
    })
  }
}
