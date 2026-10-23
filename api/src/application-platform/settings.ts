import type { ApplicationMarketSettings } from '@t-box/app-contracts'
import type { DataSource, EntityManager } from 'typeorm'
import type { ConfigurationCache } from '../configuration/cache.js'
import { PlatformConfigurationEntity, PlatformConfigurationHistoryEntity, PlatformConfigurationStateEntity } from '../db/records/configuration-entities.js'
import { ErrorCode } from '../error-codes.js'

export const APPLICATION_MARKET_KEY = 'host.applicationMarket'
const defaults: ApplicationMarketSettings = { hidden: false }

/** Host policy, deliberately independent of AI and individual app configuration. */
export class ApplicationMarketPolicy {
  private initialized?: Promise<void>
  constructor(private readonly source: DataSource, private readonly cache?: ConfigurationCache) {}

  initialize() {
    return this.initialized ??= this.ensure().catch((error) => {
      this.initialized = undefined
      throw error
    })
  }

  private async ensure() {
    const repository = this.source.getRepository(PlatformConfigurationEntity)
    if (await repository.existsBy({ config_key: APPLICATION_MARKET_KEY })) {
      return
    }
    try {
      await repository.insert({ config_key: APPLICATION_MARKET_KEY, definition_json: { owner: 'host', version: 1 }, value_json: defaults, updated_at: new Date().toISOString() })
    } catch (error) {
      if (!(error && typeof error === 'object' && 'driverError' in error && (error.driverError as { code?: string }).code === 'ER_DUP_ENTRY')) {
        throw error
      }
    }
  }

  async read(db?: EntityManager): Promise<ApplicationMarketSettings> {
    await this.initialize()
    const load = async () => {
      const row = await (db ?? this.source.manager).getRepository(PlatformConfigurationEntity).findOne({
        select: { value_json: true },
        where: { config_key: APPLICATION_MARKET_KEY },
        ...(db ? { lock: { mode: 'pessimistic_read' as const } } : {}),
      })
      const value = (typeof row?.value_json === 'string' ? JSON.parse(row.value_json) : row?.value_json) as { hidden?: unknown } | null
      if (!value || typeof value.hidden !== 'boolean') {
        throw ErrorCode.SCHEMA_REQUIRED('应用市场配置缺失或无效，请管理员检查')
      }
      return { hidden: value.hidden }
    }
    return !db && this.cache ? this.cache.current(this.source, 'host.applicationMarket', load) : load()
  }

  async save(value: unknown, administratorId: string) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'hidden') || !('hidden' in value) || typeof value.hidden !== 'boolean') {
      throw ErrorCode.INVALID_MARKET_SETTINGS()
    }
    await this.initialize()
    const next = { hidden: value.hidden }
    await this.source.transaction(async (db) => {
      const state = await db.getRepository(PlatformConfigurationStateEntity).findOne({ where: { id: 1 }, lock: { mode: 'pessimistic_write' } })
      if (!state) {
        throw ErrorCode.SCHEMA_REQUIRED()
      }
      await db.getRepository(PlatformConfigurationEntity).update({ config_key: APPLICATION_MARKET_KEY }, { value_json: next, updated_at: new Date().toISOString() })
      const revision = Number(state.revision) + 1
      await db.getRepository(PlatformConfigurationStateEntity).update({ id: 1 }, { revision })
      await db.getRepository(PlatformConfigurationHistoryEntity).insert({ config_key: APPLICATION_MARKET_KEY, revision, value_json: next, administrator_id: administratorId, note: next.hidden ? '隐藏应用市场，禁止用户安装' : '开放应用市场', created_at: new Date().toISOString() })
    })
    return this.read()
  }
}
