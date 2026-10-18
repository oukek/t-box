import type {
  Administrator,
  AIModelConfig,
  AIProviderConfig,
  AISettings,
} from '@t-box/shared'
import type {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
} from 'typeorm'
import { randomUUID } from 'node:crypto'
import {
  AdminUserEntity,
  ProviderEntity,
  SettingsEntity,
} from '../db/entities.js'
import { PlatformConfigurationStateEntity } from '../db/records/configuration-entities.js'
import { AiModelPoolEntity } from '../db/records/models-entities.js'
import { ErrorCode } from '../error-codes.js'
import { contextPolicy } from './context-policy.js'

export interface ProviderSecret extends AIProviderConfig {
  keyCipher: string
}
export class AdminStore {
  constructor(
    readonly source: DataSource,
    private readonly manager: EntityManager = source.manager,
  ) {}

  queryBuilder() {
    return this.manager.createQueryBuilder()
  }

  repository<T extends ObjectLiteral>(entity: EntityTarget<T>) {
    return this.manager.getRepository(entity)
  }

  async providers(): Promise<AIProviderConfig[]> {
    const rows = await this.manager
      .getRepository(ProviderEntity)
      .find({ order: { createdAt: 'ASC', id: 'ASC' } })
    return rows.map(
      ({ id, name, baseUrl, enabled, revision, maxConcurrency }) => ({
        id,
        name,
        baseUrl,
        enabled,
        revision,
        hasKey: true,
        maxConcurrency,
      }),
    )
  }

  async provider(id: string): Promise<ProviderSecret> {
    const rows = await this.repository(ProviderEntity)
      .find({
        select: {
          id: true,
          name: true,
          baseUrl: true,
          enabled: true,
          revision: true,
          maxConcurrency: true,
          keyCipher: true,
        },
        where: { id },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          baseUrl: row.baseUrl,
          enabled: row.enabled,
          revision: row.revision,
          maxConcurrency: row.maxConcurrency,
          keyCipher: row.keyCipher,
        })),
      )
    if (!rows[0]) {
      throw ErrorCode.PROVIDER_NOT_FOUND()
    }
    return { ...rows[0], enabled: Boolean(rows[0].enabled), hasKey: true }
  }

  async models(): Promise<AIModelConfig[]> {
    const rows = await this.queryBuilder()
      .select(
        'm.id,m.provider_id AS providerId,p.name AS providerName,m.model_id AS modelId,m.name,m.enabled,m.max_concurrency AS maxConcurrency,m.purpose,m.invocation_mode AS invocationMode,m.supports_vision AS supportsVision,m.supports_reasoning AS supportsReasoning,m.input_price AS inputPrice,m.output_price AS outputPrice,m.image_price AS imagePrice,m.context_policy AS contextPolicy',
      )
      .from('ai_models', 'm')
      .innerJoin('ai_providers', 'p', 'p.id=m.provider_id')
      .orderBy('m.name', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .getRawMany<AIModelConfig>()
    return rows.map((r) => ({
      ...r,
      contextPolicy: contextPolicy(
        r.contextPolicy,
        Boolean(r.supportsReasoning),
      ),
      enabled: Boolean(Number(r.enabled)),
      supportsVision: Boolean(Number(r.supportsVision)),
      supportsReasoning: Boolean(Number(r.supportsReasoning)),
    }))
  }

  async model(id: string) {
    const model = (await this.models()).find((m) => m.id === id)
    if (!model) {
      throw ErrorCode.MODEL_NOT_FOUND()
    }
    return model
  }

  async settings(): Promise<AISettings> {
    const rows = await this.repository(SettingsEntity)
      .find({
        select: { id: true, modelId: true, imageModelId: true },
        where: { id: 1 },
      })
      .then((rows) =>
        rows.map((row) => ({
          modelId: row.modelId,
          imageModelId: row.imageModelId,
        })),
      )
    if (!rows[0]) {
      throw ErrorCode.SCHEMA_REQUIRED('请先执行数据库初始化')
    }
    const pools = await this.repository(AiModelPoolEntity)
      .find({
        select: { purpose: true, model_id: true },
        order: { position: 'ASC', model_id: 'ASC' },
      })
      .then((rows) =>
        rows.map((row) => ({ purpose: row.purpose, modelId: row.model_id })),
      )
    const selected = (purpose: string, primary: string | null) => {
      if (!primary) {
        return []
      }
      const ids = pools
        .filter((row) => row.purpose === purpose)
        .map((row) => row.modelId)
      return ids.includes(primary) ? ids : [primary]
    }
    return {
      ...rows[0],
      modelIds: selected('conversation', rows[0].modelId),
      imageModelIds: selected('image', rows[0].imageModelId),
    }
  }

  async users(): Promise<Administrator[]> {
    const rows = await this.manager.getRepository(AdminUserEntity).find({
      select: { id: true, username: true, enabled: true, createdAt: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    })
    return rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
    }))
  }

  async createUser(username: string, hash: string) {
    const id = randomUUID()
    await this.manager
      .getRepository(AdminUserEntity)
      .insert({ id, username, passwordHash: hash })
    return id
  }

  async transaction<T>(work: (db: AdminStore) => Promise<T>): Promise<T> {
    return this.manager.transaction((manager) =>
      work(new AdminStore(this.source, manager)),
    )
  }

  /** Serializes selecting, disabling, editing and deleting related AI config. */
  async configMutation<T>(
    work: (db: AdminStore, settings: AISettings) => Promise<T>,
  ): Promise<T> {
    return this.transaction(async (db) => {
      const settings = await db
        .repository(SettingsEntity)
        .findOne({
          select: { id: true, modelId: true, imageModelId: true },
          where: { id: 1 },
          lock: { mode: 'pessimistic_write' },
        })
        .then((row) =>
          row
            ? {
                modelId: row.modelId,
                imageModelId: row.imageModelId,
              }
            : null,
        )
      if (!settings) {
        throw ErrorCode.SCHEMA_REQUIRED()
      }
      const result = await work(db, await db.settings())
      await db
        .repository(PlatformConfigurationStateEntity)
        .update({ id: 1 }, { ai_revision: () => 'ai_revision+1' })
      return result
    })
  }
}
