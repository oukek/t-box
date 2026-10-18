import type { RemoteModel } from '@t-box/shared'
import type { createVault } from './crypto.js'
import type { AdminStore, ProviderSecret } from './store.js'
import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { WorkflowConfigurationStore } from '../agent-workflow/configuration.js'
import { ProviderConcurrency } from '../billing/concurrency.js'
import { prices } from '../billing/money.js'
import { publicRunError } from '../chat/errors.js'
import {
  invocationContextPolicy,
  invocationMode,
} from '../chat/invocation-mode.js'
import { createConversationProvider } from '../chat/provider-factory.js'
import { ConfigurationCache } from '../configuration/cache.js'
import { settingNumber } from '../configuration/defaults.js'
import { ConfigurationStore } from '../configuration/store.js'
import { ModelEntity, ProviderEntity } from '../db/entities.js'
import { PlatformConfigurationStateEntity } from '../db/records/configuration-entities.js'
import { AiModelPoolEntity } from '../db/records/models-entities.js'
import { ErrorCode } from '../error-codes.js'
import { ModelRouting } from '../models/routing.js'
import { contextPolicy } from './context-policy.js'
import { bad, baseUrl, body, enabled, text } from './validation.js'

export class ConfigurationService {
  readonly workflow: WorkflowConfigurationStore
  readonly configuration: ConfigurationStore
  constructor(
    readonly store: AdminStore,
    private readonly vault: ReturnType<typeof createVault>,
    readonly cache = new ConfigurationCache(),
  ) {
    this.workflow = new WorkflowConfigurationStore(store.source, cache)
    this.configuration = new ConfigurationStore(store.source, cache)
  }

  private async client(provider: ProviderSecret) {
    const configuration = await this.configuration.snapshot()
    return new OpenAI({
      apiKey: this.vault.decrypt(provider.keyCipher),
      baseURL: provider.baseUrl,
      timeout: settingNumber(
        configuration,
        'ai.provider.modelsTimeoutMs',
        12_000,
      ),
      maxRetries: 0,
      fetch: (url, options) => fetch(url, { ...options, redirect: 'error' }),
    })
  }

  async saveProvider(value: unknown, id?: string) {
    const input = body(value, [
      'name',
      'baseUrl',
      'apiKey',
      'enabled',
      'maxConcurrency',
    ])
    const name = text(input.name, '名称')
    const url = baseUrl(input.baseUrl)
    const active = enabled(input.enabled)
    if (
      input.apiKey !== undefined &&
      (typeof input.apiKey !== 'string' || input.apiKey.length > 4096)
    ) {
      bad('API Key 格式不正确')
    }
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
    return this.store.configMutation(async (db, settings) => {
      const old = id ? await db.provider(id) : undefined
      const maxConcurrency = concurrencyLimit(
        input.maxConcurrency,
        old?.maxConcurrency ?? 0,
        true,
      )
      if (!apiKey && (!old || old.baseUrl !== url)) {
        bad('新增服务商或修改 API 地址时必须填写 API Key')
      }
      if (
        !active &&
        (await db.models()).some(
          (m) =>
            [
              ...(settings.modelIds || []),
              ...(settings.imageModelIds || []),
            ].includes(m.id) && m.providerId === id,
        )
      ) {
        bad('请先将关联模型移出模型池，再停用服务商')
      }
      const target = id ?? randomUUID()
      const cipher = apiKey ? this.vault.encrypt(apiKey) : old!.keyCipher
      if (old) {
        await db.repository(ProviderEntity).update(
          { id: target },
          {
            name,
            baseUrl: url,
            keyCipher: cipher,
            enabled: active,
            maxConcurrency,
            revision: () => 'revision+1',
          },
        )
      } else {
        await db.repository(ProviderEntity).insert({
          id: target,
          name,
          baseUrl: url,
          keyCipher: cipher,
          enabled: active,
          maxConcurrency,
        })
      }
      return target
    })
  }

  async remoteModels(id: string): Promise<RemoteModel[]> {
    const provider = await this.store.provider(id)
    if (!provider.enabled) {
      bad('请先启用服务商')
    }
    try {
      const page = await (await this.client(provider)).models.list()
      // Models endpoint returns a bounded list; never return arbitrary upstream fields.
      if (!Array.isArray(page.data) || page.data.length > 5000) {
        throw ErrorCode.INTERNAL_INVALID_MODEL_LIST()
      }
      return [
        ...new Map(
          page.data
            .filter((m) => typeof m.id === 'string' && m.id.length <= 200)
            .map((m) => [
              m.id,
              {
                id: m.id,
                ownedBy:
                  typeof m.owned_by === 'string'
                    ? m.owned_by.slice(0, 100)
                    : '',
              },
            ]),
        ).values(),
      ].sort((a, b) => a.id.localeCompare(b.id))
    } catch {
      throw ErrorCode.PROVIDER_UNAVAILABLE()
    }
  }

  async saveModel(value: unknown, id?: string) {
    const input = body(value, [
      'providerId',
      'modelId',
      'name',
      'enabled',
      'purpose',
      'supportsVision',
      'supportsReasoning',
      'invocationMode',
      'inputPrice',
      'outputPrice',
      'imagePrice',
      'contextPolicy',
      'maxConcurrency',
    ])
    const providerId = text(input.providerId, '服务商', 36)
    const modelId = text(input.modelId, '模型标识', 200)
    const name = text(input.name, '显示名称')
    const active = enabled(input.enabled)
    const purpose = input.purpose ?? 'conversation'
    if (!['conversation', 'image'].includes(String(purpose))) {
      bad('模型用途无效')
    }
    const supportsVision =
      input.supportsVision === undefined ? false : enabled(input.supportsVision)
    const supportsReasoning =
      input.supportsReasoning === undefined
        ? false
        : enabled(input.supportsReasoning)
    const provider = await this.store.provider(providerId)
    const previous = id ? await this.store.model(id) : undefined
    const maxConcurrency = concurrencyLimit(
      input.maxConcurrency,
      previous?.maxConcurrency ?? 4,
    )
    const method = invocationMode(
      input.invocationMode ??
      (previous?.purpose === purpose ? previous.invocationMode : undefined),
      purpose as 'conversation' | 'image',
    )
    const policy = invocationContextPolicy(
      method,
      contextPolicy(
        input.contextPolicy ?? previous?.contextPolicy,
        supportsReasoning,
      ),
    )
    const pricing = prices({
      inputPrice:
        (input.inputPrice as string | undefined) ?? previous?.inputPrice,
      outputPrice:
        (input.outputPrice as string | undefined) ?? previous?.outputPrice,
      imagePrice:
        (input.imagePrice as string | undefined) ?? previous?.imagePrice,
    })
    // Existing selection remains editable if the upstream list is temporarily down.
    if (
      !previous ||
      previous.providerId !== providerId ||
      previous.modelId !== modelId
    ) {
      const options = await this.remoteModels(providerId)
      if (!options.some((m) => m.id === modelId)) {
        bad('请从服务商返回的模型列表中选择')
      }
    }
    return this.store.configMutation(async (db, settings) => {
      if (id) {
        await db.model(id)
      }
      const currentProvider = await db.provider(providerId)
      if (currentProvider.revision !== provider.revision) {
        bad('服务商配置已变更，请重新加载模型列表')
      }
      if (
        [
          ...(settings.modelIds || []),
          ...(settings.imageModelIds || []),
        ].includes(id ?? '') &&
        (!active || !currentProvider.enabled || previous?.purpose !== purpose)
      ) {
        bad('请先将模型移出模型池，再停用或修改用途')
      }
      const target = id ?? randomUUID()
      if (id) {
        await db.repository(ModelEntity).update(
          { id: target },
          {
            providerId,
            modelId,
            name,
            enabled: active,
            purpose: purpose as 'conversation' | 'image',
            supportsVision,
            supportsReasoning,
            invocationMode: method,
            inputPrice: pricing.inputPrice,
            outputPrice: pricing.outputPrice,
            imagePrice: pricing.imagePrice,
            contextPolicy: policy,
            maxConcurrency,
          },
        )
      } else {
        await db.repository(ModelEntity).insert({
          id: target,
          providerId,
          modelId,
          name,
          enabled: active,
          purpose: purpose as 'conversation' | 'image',
          supportsVision,
          supportsReasoning,
          invocationMode: method,
          inputPrice: pricing.inputPrice,
          outputPrice: pricing.outputPrice,
          imagePrice: pricing.imagePrice,
          contextPolicy: policy,
          maxConcurrency,
        })
      }
      return target
    })
  }

  async selectModel(value: unknown) {
    const input = body(value, [
      'modelId',
      'imageModelId',
      'modelIds',
      'imageModelIds',
    ])
    return this.store.configMutation(async (db, settings) => {
      for (const [single, many, purpose] of [
        ['modelId', 'modelIds', 'conversation'],
        ['imageModelId', 'imageModelIds', 'image'],
      ] as const) {
        if (input[single] === undefined && input[many] === undefined) {
          continue
        }
        const supplied =
          input[many] ?? (input[single] == null ? [] : [input[single]])
        if (!Array.isArray(supplied) || supplied.length > 32) {
          bad('每种用途最多选择 32 个模型')
        }
        const ids = (supplied as unknown[]).map((value) =>
          text(value, '模型配置', 36),
        )
        if (new Set(ids).size !== ids.length) {
          bad('模型配置不能重复')
        }
        if (
          input[many] !== undefined &&
          input[single] !== undefined &&
          (input[single] ?? null) !== (ids[0] ?? null)
        ) {
          bad('模型池与默认模型不一致')
        }
        for (const id of ids) {
          const model = await db.model(id)
          if (
            !model.enabled ||
            !(await db.provider(model.providerId)).enabled ||
            model.purpose !== purpose
          ) {
            bad('请选择对应用途的已启用模型和服务商')
          }
        }
        await db.repository(AiModelPoolEntity).delete({ purpose })
        for (const [position, id] of ids.entries()) {
          await db
            .repository(AiModelPoolEntity)
            .insert({ purpose, model_id: id, position })
        }
        await db
          .queryBuilder()
          .update('ai_settings')
          .set({ [single]: ids[0] ?? null })
          .updateEntity(false)
          .where('id=1')
          .execute()
        settings[single] = ids[0] ?? null
        settings[many] = ids
      }
      return settings
    })
  }

  async remove(kind: 'providers' | 'models', id: string) {
    await this.store.configMutation(async (db, settings) => {
      if (kind === 'models') {
        await db.model(id)
        if (
          [
            ...(settings.modelIds || []),
            ...(settings.imageModelIds || []),
          ].includes(id)
        ) {
          bad('此模型仍在模型池中，请先移出后再删除')
        }
        await db.repository(ModelEntity).delete({ id })
      } else {
        await db.provider(id)
        if ((await db.models()).some((m) => m.providerId === id)) {
          bad('请先删除此服务商关联的模型配置')
        }
        await db.repository(ProviderEntity).delete({ id })
      }
    })
  }

  async runtime(
    purpose: 'conversation' | 'image' = 'conversation',
    options: {
      configurationKey?: string
      preferredConfigurationKey?: string
      supportsVision?: boolean
      peek?: boolean
    } = {},
  ) {
    const column = purpose === 'image' ? 'image_model_id' : 'model_id'
    const state = await this.store
      .repository(PlatformConfigurationStateEntity)
      .findOne({ select: { ai_revision: true }, where: { id: 1 } })
      .then((row) => (row ? { revision: row.ai_revision } : null))
    const rows = await this.cache.read(
      `ai-runtime-pool-v1-${purpose}`,
      Number(state?.revision ?? 0),
      () =>
        this.store
          .queryBuilder()
          .select(
            'm.id AS modelId,m.name AS modelName,p.name AS providerName,m.model_id AS remoteId,m.purpose,m.invocation_mode AS invocationMode,\n      m.input_price AS inputPrice,m.output_price AS outputPrice,m.image_price AS imagePrice,m.context_policy AS contextPolicy,\n      m.supports_vision AS supportsVision,m.supports_reasoning AS supportsReasoning,m.enabled AS modelEnabled,p.enabled AS providerEnabled,\n      m.max_concurrency AS maxConcurrency,p.max_concurrency AS providerConcurrency,p.id,p.base_url AS baseUrl,p.key_cipher AS keyCipher,p.revision',
          )
          .from('ai_settings', 's')
          .innerJoin(
            'ai_models',
            'm',
            `(m.id=s.${column} OR (
        EXISTS(SELECT 1 FROM ai_model_pool a WHERE a.purpose=:p0 AND a.model_id=s.${column}) AND
        EXISTS(SELECT 1 FROM ai_model_pool b WHERE b.purpose=:p1 AND b.model_id=m.id)))`,
          )
          .innerJoin('ai_providers', 'p', 'p.id=m.provider_id')
          .where(`s.id=1 AND s.${column} IS NOT NULL`)
          .orderBy('m.id', 'ASC')
          .setParameters({ p0: purpose, p1: purpose })
          .getRawMany<{
          inputPrice: string
          outputPrice: string
          imagePrice: string
          contextPolicy: unknown
          modelId: string
          modelName: string
          providerName: string
          remoteId: string
          purpose: string
          invocationMode: import('@t-box/shared').ModelInvocationMode
          supportsVision: number
          supportsReasoning: number
          modelEnabled: number
          providerEnabled: number
          id: string
          baseUrl: string
          keyCipher: string
          revision: number
          maxConcurrency: number
          providerConcurrency: number
        }>(),
    )
    if (!rows.length) {
      return null
    }
    if (rows.every((row) => row.purpose !== purpose)) {
      throw ErrorCode.MODEL_PURPOSE_MISMATCH()
    }
    const eligible = rows.filter(
      (row) =>
        row.purpose === purpose &&
        row.modelEnabled &&
        row.providerEnabled &&
        (!options.supportsVision || row.supportsVision),
    )
    if (!eligible.length) {
      throw options.supportsVision
        ? ErrorCode.VISION_MODEL_REQUIRED.unavailable()
        : ErrorCode.AI_DISABLED()
    }
    const configuration = await this.configuration.snapshot()
    const pinned = options.configurationKey
      ? eligible.find((row) =>
          options.configurationKey!.startsWith(row.modelId + ':'),
        )
      : undefined
    if (options.configurationKey && !pinned) {
      throw ErrorCode.TASK_MODEL_CHANGED()
    }
    const preferred =
      configuration.values['ai.routing.conversationAffinity'] !== false
        ? eligible.find((row) =>
            options.preferredConfigurationKey?.startsWith(row.modelId + ':'),
          )
        : undefined
    const row =
      pinned ??
      (options.peek
        ? eligible[0]!
        : await new ModelRouting(this.store.source).select(
            purpose,
            eligible,
            configuration,
            preferred?.modelId,
          ))
    const method = invocationMode(row.invocationMode, purpose)
    const policy = invocationContextPolicy(
      method,
      contextPolicy(row.contextPolicy, Boolean(row.supportsReasoning)),
    )
    return {
      configuration,
      modelName: row.modelName,
      providerName: row.providerName,
      maxConcurrency: row.maxConcurrency,
      providerConcurrency: row.providerConcurrency,
      invocationMode: method,
      billingModelId: row.modelId,
      providerId: row.id,
      contextPolicy: policy,
      prices: prices(row),
      model: row.remoteId,
      supportsVision: Boolean(Number(row.supportsVision)),
      supportsReasoning: Boolean(Number(row.supportsReasoning)),
      baseURL: row.baseUrl,
      apiKey: this.vault.decrypt(row.keyCipher),
      configurationKey: `${row.modelId}:${method}:${row.remoteId}:${row.id}:${row.revision}${row.supportsReasoning ? ':reasoning-summary' : ''}:${JSON.stringify(policy)}`,
    }
  }

  async testModel(id: string) {
    const model = await this.store.model(id)
    const provider = await this.store.provider(model.providerId)
    if (!model.enabled || !provider.enabled) {
      bad('请先启用模型和服务商')
    }
    if (model.purpose === 'image') {
      bad(
        '图片模型通过生成/编辑工具使用；此按钮仅测试普通会话，避免测试时自动生成图片',
      )
    }
    try {
      const configuration = await this.configuration.snapshot()
      const runtime = createConversationProvider(
        {
          apiKey: '',
          model: model.modelId,
          invocationMode: model.invocationMode,
          supportsReasoning: model.supportsReasoning,
          supportsVision: model.supportsVision,
          contextPolicy: model.contextPolicy,
          configuration,
        },
        await this.client(provider),
      )
      const signal = AbortSignal.timeout(
        settingNumber(configuration, 'ai.provider.modelsTimeoutMs', 12_000),
      )
      const turn = await new ProviderConcurrency(this.store.source).run(
        provider.id,
        signal,
        configuration,
        (signal) =>
          runtime.next({
            history: [
              {
                role: 'user',
                content: 'Call connection_check with no arguments.',
              },
            ],
            instructions:
              '这是连接测试，只调用 connection_check，不执行其他操作。',
            localDate: new Date().toISOString().slice(0, 10),
            signal,
            onDelta() {},
            publicReasoning: false,
            tools: [
              {
                type: 'function',
                name: 'connection_check',
                description: 'A harmless connection check.',
                strict: true,
                parameters: {
                  type: 'object',
                  properties: {},
                  required: [],
                  additionalProperties: false,
                },
              },
            ],
            toolChoice: { type: 'function', name: 'connection_check' },
          }),
        {
          id: model.id,
          maxConcurrency: model.maxConcurrency ?? 4,
          providerConcurrency: provider.maxConcurrency ?? 0,
        },
      )
      if (!turn.calls.some((item) => item.name === 'connection_check')) {
        throw ErrorCode.MODEL_TOOL_UNSUPPORTED()
      }
      return {
        message: `${model.invocationMode === 'chat_completions' ? 'Chat Completions' : 'Responses'} 流式响应与工具调用测试通过`,
      }
    } catch (error) {
      throw ErrorCode.MODEL_TEST_FAILED(
        `测试失败：${publicRunError(error).message}`,
      )
    }
  }
}

function concurrencyLimit(value: unknown, fallback: number, allowZero = false) {
  if (value === undefined) {
    return fallback
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 128
  ) {
    bad('并发上限需为 1–128 的整数，服务商可填 0 跟随全局配置')
  }
  return value as number
}
