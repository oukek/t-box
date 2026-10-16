import type {
  Administrator,
  AIModelConfig,
  AIProviderConfig,
  AISettings,
} from '@t-box/shared'
import type { DataSource, EntityManager } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'
import { AdminUserEntity, ProviderEntity } from '../db/entities.js'
import { contextPolicy } from './context-policy.js'

export interface ProviderSecret extends AIProviderConfig {
  keyCipher: string
}
export class AdminStore {
  constructor(
    readonly source: DataSource,
    private readonly manager: EntityManager = source.manager,
  ) {}

  async rows<T>(
    sql: string,
    values: (string | number | boolean | null | Date)[] = [],
  ): Promise<T[]> {
    return this.manager.query(sql, values) as Promise<T[]>
  }

  async execute(
    sql: string,
    values: (string | number | boolean | null | Date)[] = [],
  ) {
    return this.manager.query(sql, values)
  }

  async providers(): Promise<AIProviderConfig[]> {
    const rows = await this.manager
      .getRepository(ProviderEntity)
      .find({ order: { createdAt: 'ASC', id: 'ASC' } })
    return rows.map(({ id, name, baseUrl, enabled, revision, maxConcurrency }) => ({
      id,
      name,
      baseUrl,
      enabled,
      revision,
      hasKey: true,
      maxConcurrency,
    }))
  }

  async provider(id: string): Promise<ProviderSecret> {
    const rows = await this.rows<ProviderSecret>(
      'SELECT id,name,base_url AS baseUrl,enabled,revision,max_concurrency AS maxConcurrency,key_cipher AS keyCipher FROM ai_providers WHERE id=?',
      [id],
    )
    if (!rows[0]) {
      throw new ApiError(404, 'PROVIDER_NOT_FOUND', '服务商不存在')
    }
    return { ...rows[0], enabled: Boolean(rows[0].enabled), hasKey: true }
  }

  async models(): Promise<AIModelConfig[]> {
    const rows = await this.rows<AIModelConfig>(
      'SELECT m.id,m.provider_id AS providerId,p.name AS providerName,m.model_id AS modelId,m.name,m.enabled,m.max_concurrency AS maxConcurrency,m.purpose,m.invocation_mode AS invocationMode,m.supports_vision AS supportsVision,m.supports_reasoning AS supportsReasoning,m.input_price AS inputPrice,m.output_price AS outputPrice,m.image_price AS imagePrice,m.context_policy AS contextPolicy FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id ORDER BY m.name,m.id',
    )
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
      throw new ApiError(404, 'MODEL_NOT_FOUND', '模型配置不存在')
    }
    return model
  }

  async settings(): Promise<AISettings> {
    const rows = await this.rows<AISettings>(
      'SELECT model_id AS modelId,image_model_id AS imageModelId FROM ai_settings WHERE id=1',
    )
    if (!rows[0]) {
      throw new ApiError(503, 'SCHEMA_REQUIRED', '请先执行数据库初始化')
    }
    const pools = await this.rows<{ purpose: string, modelId: string }>('SELECT purpose,model_id AS modelId FROM ai_model_pool ORDER BY position,model_id')
    const selected = (purpose: string, primary: string | null) => {
      if (!primary) {
        return []
      }
      const ids = pools.filter((row) => row.purpose === purpose).map((row) => row.modelId)
      return ids.includes(primary) ? ids : [primary]
    }
    return { ...rows[0], modelIds: selected('conversation', rows[0].modelId), imageModelIds: selected('image', rows[0].imageModelId) }
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
      const [settings] = await db.rows<AISettings>(
        'SELECT model_id AS modelId,image_model_id AS imageModelId FROM ai_settings WHERE id=1 FOR UPDATE',
      )
      if (!settings) {
        throw new ApiError(503, 'SCHEMA_REQUIRED', '请先初始化数据库')
      }
      const result = await work(db, await db.settings())
      await db.execute(
        'UPDATE platform_configuration_state SET ai_revision=ai_revision+1 WHERE id=1',
      )
      return result
    })
  }
}
