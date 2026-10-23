import type { HostDownloadSettings } from '@t-box/app-contracts'
import type { DataSource } from 'typeorm'
import type { ConfigurationCache } from '../configuration/cache.js'
import { defaultHostDownloads, parseHostDownloads } from '@t-box/app-contracts'
import { PlatformConfigurationEntity, PlatformConfigurationHistoryEntity, PlatformConfigurationStateEntity } from '../db/records/configuration-entities.js'
import { ErrorCode } from '../error-codes.js'

export const HOST_DOWNLOADS_KEY = 'host.downloads'

export class HostDownloadConfiguration {
  constructor(private readonly source: DataSource, private readonly cache?: ConfigurationCache) {}

  async read(): Promise<HostDownloadSettings> {
    const load = async () => {
      const row = await this.source.getRepository(PlatformConfigurationEntity).findOne({ select: { value_json: true }, where: { config_key: HOST_DOWNLOADS_KEY } })
      if (!row) {
        return { ...defaultHostDownloads }
      }
      const value = parseHostDownloads(typeof row.value_json === 'string' ? JSON.parse(row.value_json) : row.value_json)
      if (!value) {
        throw ErrorCode.INVALID_HOST_DOWNLOADS('应用下载配置无效，请管理员检查')
      }
      return value
    }
    return this.cache ? this.cache.current(this.source, HOST_DOWNLOADS_KEY, load) : load()
  }

  async save(input: unknown, administratorId: string) {
    const value = parseHostDownloads(input)
    if (!value) {
      throw ErrorCode.INVALID_HOST_DOWNLOADS()
    }
    await this.source.transaction(async (db) => {
      const state = await db.getRepository(PlatformConfigurationStateEntity).findOne({ where: { id: 1 }, lock: { mode: 'pessimistic_write' } })
      if (!state) {
        throw ErrorCode.SCHEMA_REQUIRED()
      }
      await db.getRepository(PlatformConfigurationEntity).save({ config_key: HOST_DOWNLOADS_KEY, definition_json: { owner: 'host', version: 1 }, value_json: value, updated_at: new Date().toISOString() })
      const revision = Number(state.revision) + 1
      await db.getRepository(PlatformConfigurationStateEntity).update({ id: 1 }, { revision })
      await db.getRepository(PlatformConfigurationHistoryEntity).insert({ config_key: HOST_DOWNLOADS_KEY, revision, value_json: value, administrator_id: administratorId, note: '更新宿主应用下载引导', created_at: new Date().toISOString() })
    })
    return this.read()
  }
}
