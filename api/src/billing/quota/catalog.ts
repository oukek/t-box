import type {
  AdminResourcePackage,
  QuotaTariff,
  ResourcePackage,
  ResourcePackageDraft,
} from '@t-box/shared'
import type { DataSource, EntityManager } from 'typeorm'
import type { ConfigurationCache } from '../../configuration/cache.js'
import { randomUUID } from 'node:crypto'
import { object } from '@t-box/server-foundation/input'
import { sqlClock } from '@t-box/server-foundation/persistence/columns'
import { isoTime } from '@t-box/server-foundation/time'
import { PlatformConfigurationStateEntity } from '../../db/records/configuration-entities.js'
import { ErrorCode } from '../../error-codes.js'
import { money } from '../money.js'
import {
  QuotaProductEntity,
  QuotaProductVersionEntity,
  QuotaTariffEntity,
} from './entities.js'
import { quota } from './math.js'

function text(value: unknown, max: number, empty = false) {
  if (
    typeof value !== 'string' ||
    (!empty && !value.trim()) ||
    value.trim().length > max
  ) {
    throw ErrorCode.QUOTA_INVALID()
  }
  return value.trim()
}
export function packageDraft(value: unknown): ResourcePackageDraft {
  const row = object(value, [
    'code',
    'name',
    'price',
    'quota',
    'bonusQuota',
    'validDays',
    'description',
    'sort',
    'enabled',
  ])
  const code = text(row.code, 40)
  if (
    !/^[a-z][a-z0-9-]{1,39}$/.test(code) ||
    typeof row.enabled !== 'boolean' ||
    !Number.isSafeInteger(row.sort) ||
    Number(row.sort) < 0 ||
    Number(row.sort) > 10000 ||
    !Number.isSafeInteger(row.validDays) ||
    Number(row.validDays) < 1 ||
    Number(row.validDays) > 3650
  ) {
    throw ErrorCode.QUOTA_INVALID()
  }
  const amount = money(row.price)
  const cents = amount / 10000n
  if (amount % 10000n || cents < 1n || cents > 1000000n) {
    throw ErrorCode.QUOTA_INVALID('资源包售价须为 0.01–10000 元，最多两位小数')
  }
  if (
    quota(row.quota) <= 0n ||
    quota(row.quota) % 10000n ||
    quota(row.bonusQuota) % 10000n
  ) {
    throw ErrorCode.QUOTA_INVALID()
  }
  return {
    code,
    name: text(row.name, 60),
    price: `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`,
    quota: String(quota(row.quota) / 10000n),
    bonusQuota: String(quota(row.bonusQuota) / 10000n),
    validDays: Number(row.validDays),
    description: text(row.description, 500, true),
    sort: Number(row.sort),
    enabled: row.enabled,
  }
}
export function tariffInput(
  value: unknown,
): Omit<QuotaTariff, 'version' | 'publishedAt'> {
  const row = object(value, [
    'enabled',
    'inputPerMillion',
    'outputPerMillion',
    'cachedInputPerMillion',
    'images',
    'edits',
    'taskLimit',
    'imageLimit',
  ])
  if (
    typeof row.enabled !== 'boolean' ||
    !Number.isSafeInteger(row.imageLimit) ||
    Number(row.imageLimit) < 1 ||
    Number(row.imageLimit) > 20
  ) {
    throw ErrorCode.QUOTA_INVALID()
  }
  for (const key of [
    'inputPerMillion',
    'outputPerMillion',
    'cachedInputPerMillion',
    'taskLimit',
  ] as const) {
    if (quota(row[key]) <= 0n) {
      throw ErrorCode.QUOTA_INVALID()
    }
  }
  if (quota(row.cachedInputPerMillion) > quota(row.inputPerMillion)) {
    throw ErrorCode.QUOTA_INVALID('缓存输入费率不能高于普通输入费率')
  }
  const tiers = (value: unknown) => {
    const v = object(value, ['1k', '2k', '4k'])
    for (const key of ['1k', '2k', '4k'] as const) {
      if (quota(v[key]) <= 0n || quota(v[key]) % 10000n) {
        throw ErrorCode.QUOTA_INVALID('图片档位须为正整数额度')
      }
    }
    return {
      '1k': String(v['1k']),
      '2k': String(v['2k']),
      '4k': String(v['4k']),
    }
  }
  return {
    enabled: row.enabled,
    inputPerMillion: String(row.inputPerMillion),
    outputPerMillion: String(row.outputPerMillion),
    cachedInputPerMillion: String(row.cachedInputPerMillion),
    images: tiers(row.images),
    edits: tiers(row.edits),
    taskLimit: String(row.taskLimit),
    imageLimit: Number(row.imageLimit),
  }
}
export class QuotaCatalog {
  constructor(
    readonly source: DataSource,
    private readonly cache?: ConfigurationCache,
  ) {}

  private async changed(db: EntityManager) {
    await db
      .getRepository(PlatformConfigurationStateEntity)
      .increment({ id: 1 }, 'revision', 1)
  }

  private async guard(db: EntityManager) {
    await db.getRepository(PlatformConfigurationStateEntity).findOneOrFail({
      select: { id: true },
      where: { id: 1 },
      lock: { mode: 'pessimistic_write' },
    })
  }

  async list(
    db: EntityManager = this.source.manager,
  ): Promise<AdminResourcePackage[]> {
    const products = await db.getRepository(QuotaProductEntity).find({
      select: {
        id: true,
        code: true,
        draft: true,
        revision: true,
        currentVersion: true,
      },
      order: { code: 'ASC' },
    })
    const result: AdminResourcePackage[] = []
    for (const row of products) {
      const version = row.currentVersion
        ? await db.getRepository(QuotaProductVersionEntity).findOne({
            select: { configuration: true, version: true, createdAt: true },
            where: { productId: row.id, version: row.currentVersion },
          })
        : null
      result.push({
        id: row.id,
        revision: row.revision,
        draft: row.draft,
        published: version
          ? {
              ...version.configuration,
              id: row.id,
              revision: row.revision,
              version: version.version,
              publishedAt: isoTime(version.createdAt),
            }
          : null,
      })
    }
    return result.sort(
      (a, b) => a.draft.sort - b.draft.sort || a.id.localeCompare(b.id),
    )
  }

  async products(): Promise<ResourcePackage[]> {
    const load = async () =>
      (await this.list())
        .flatMap((row) => (row.published?.enabled ? [row.published] : []))
        .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    return this.cache
      ? this.cache.current(this.source, 'quota-products', load)
      : load()
  }

  async save(value: unknown, id?: string, revision?: number) {
    const draft = packageDraft(value)
    return this.source.transaction(async (db) => {
      await this.guard(db)
      const repo = db.getRepository(QuotaProductEntity)
      if (id) {
        const current = await repo.findOne({
          select: { revision: true, code: true },
          where: { id },
          lock: { mode: 'pessimistic_write' },
        })
        if (
          !current ||
          current.revision !== revision ||
          current.code !== draft.code
        ) {
          throw ErrorCode.PACKAGE_CONFLICT()
        }
        await repo.update({ id }, { draft, revision: revision! + 1 })
      } else {
        if (await repo.existsBy({ code: draft.code })) {
          throw ErrorCode.PACKAGE_CONFLICT('商品编码已存在')
        }
        id = randomUUID()
        await repo.insert({
          id,
          code: draft.code,
          draft,
          currentVersion: 0,
          revision: 1,
        })
      }
      await this.changed(db)
      return id
    })
  }

  async publish(id: string, revision: number) {
    await this.source.transaction(async (db) => {
      await this.guard(db)
      const repo = db.getRepository(QuotaProductEntity)
      const row = await repo.findOne({
        select: { id: true, revision: true, currentVersion: true, draft: true },
        where: { id },
        lock: { mode: 'pessimistic_write' },
      })
      if (!row || row.revision !== revision) {
        throw ErrorCode.PACKAGE_CONFLICT()
      }
      const draft = packageDraft(row.draft)
      await db.getRepository(QuotaProductVersionEntity).insert({
        id: randomUUID(),
        productId: id,
        version: row.currentVersion + 1,
        configuration: draft,
        createdAt: sqlClock(new Date()),
      })
      await repo.update(
        { id },
        { currentVersion: row.currentVersion + 1, revision: row.revision + 1 },
      )
      await this.changed(db)
    })
  }

  async purchaseVersion(db: EntityManager, productId: string, version: number) {
    const product = await db.getRepository(QuotaProductEntity).findOne({
      select: { id: true, currentVersion: true },
      where: { id: productId },
    })
    const row =
      product &&
      (await db.getRepository(QuotaProductVersionEntity).findOne({
        select: { id: true, configuration: true, version: true },
        where: { productId, version },
      }))
    if (!row?.configuration.enabled || product?.currentVersion !== version) {
      throw ErrorCode.PACKAGE_NOT_AVAILABLE()
    }
    return row
  }

  async tariff(): Promise<QuotaTariff> {
    const load = async () => {
      const row = await this.source.getRepository(QuotaTariffEntity).findOne({
        select: { configuration: true },
        where: {},
        order: { version: 'DESC' },
      })
      if (!row) {
        throw ErrorCode.QUOTA_TARIFF_REQUIRED()
      }
      return row.configuration
    }
    return this.cache
      ? this.cache.current(this.source, 'quota-tariff', load)
      : load()
  }

  async publishTariff(
    value: unknown,
    expectedVersion: number,
    administratorId: string,
  ) {
    const configuration = tariffInput(value)
    return this.source.transaction(async (db) => {
      await this.guard(db)
      const current = await db.getRepository(QuotaTariffEntity).findOneOrFail({
        select: { version: true },
        where: {},
        order: { version: 'DESC' },
      })
      if (current.version !== expectedVersion) {
        throw ErrorCode.PACKAGE_CONFLICT()
      }
      const next: QuotaTariff = {
        ...configuration,
        version: current.version + 1,
        publishedAt: new Date().toISOString(),
      }
      await db.getRepository(QuotaTariffEntity).insert({
        version: next.version,
        configuration: next,
        administratorId,
        createdAt: sqlClock(new Date()),
      })
      await this.changed(db)
      return next
    })
  }
}
