import type { RemoteModel } from '@t-box/shared'
import type { createVault } from './crypto.js'
import type { AdminStore, ProviderSecret } from './store.js'
import { randomUUID } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'
import OpenAI from 'openai'
import { WorkflowConfigurationStore } from '../agent-workflow/configuration.js'
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
    const input = body(value, ['name', 'baseUrl', 'apiKey', 'enabled'])
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
      if (!apiKey && (!old || old.baseUrl !== url)) {
        bad('新增服务商或修改 API 地址时必须填写 API Key')
      }
      if (
        !active &&
        (await db.models()).some(
          (m) =>
            [settings.modelId, settings.imageModelId].includes(m.id) &&
            m.providerId === id,
        )
      ) {
        bad('请先切换当前对话模型，再停用服务商')
      }
      const target = id ?? randomUUID()
      const cipher = apiKey ? this.vault.encrypt(apiKey) : old!.keyCipher
      if (old) {
        await db.execute(
          'UPDATE ai_providers SET name=?,base_url=?,key_cipher=?,enabled=?,revision=revision+1 WHERE id=?',
          [name, url, cipher, active, target],
        )
      } else {
        await db.execute(
          'INSERT INTO ai_providers (id,name,base_url,key_cipher,enabled) VALUES (?,?,?,?,?)',
          [target, name, url, cipher, active],
        )
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
        throw new Error('invalid model list')
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
      throw new ApiError(
        502,
        'PROVIDER_UNAVAILABLE',
        '模型列表加载失败，请检查 API 地址、密钥和服务商的 /models 支持情况',
      )
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
      input.supportsVision === undefined
        ? false
        : enabled(input.supportsVision)
    const supportsReasoning =
      input.supportsReasoning === undefined
        ? false
        : enabled(input.supportsReasoning)
    const provider = await this.store.provider(providerId)
    const previous = id ? await this.store.model(id) : undefined
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
        [settings.modelId, settings.imageModelId].includes(id ?? '') &&
        (!active || !currentProvider.enabled || previous?.purpose !== purpose)
      ) {
        bad('请先切换当前对话模型，再停用')
      }
      const target = id ?? randomUUID()
      if (id) {
        await db.execute(
          'UPDATE ai_models SET provider_id=?,model_id=?,name=?,enabled=?,purpose=?,supports_vision=?,supports_reasoning=?,invocation_mode=?,input_price=?,output_price=?,image_price=?,context_policy=? WHERE id=?',
          [
            providerId,
            modelId,
            name,
            active,
            purpose as string,
            supportsVision,
            supportsReasoning,
            method,
            pricing.inputPrice,
            pricing.outputPrice,
            pricing.imagePrice,
            JSON.stringify(policy),
            target,
          ],
        )
      } else {
        await db.execute(
          'INSERT INTO ai_models (id,provider_id,model_id,name,enabled,purpose,supports_vision,supports_reasoning,invocation_mode,input_price,output_price,image_price,context_policy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [
            target,
            providerId,
            modelId,
            name,
            active,
            purpose as string,
            supportsVision,
            supportsReasoning,
            method,
            pricing.inputPrice,
            pricing.outputPrice,
            pricing.imagePrice,
            JSON.stringify(policy),
          ],
        )
      }
      return target
    })
  }

  async selectModel(value: unknown) {
    const input = body(value, ['modelId', 'imageModelId'])
    return this.store.configMutation(async (db, settings) => {
      for (const [field, purpose, column] of [
        ['modelId', 'conversation', 'model_id'],
        ['imageModelId', 'image', 'image_model_id'],
      ] as const) {
        if (input[field] === undefined) {
          continue
        }
        const id =
          input[field] === null ? null : text(input[field], '模型配置', 36)
        if (id) {
          const model = await db.model(id)
          if (
            !model.enabled ||
            !(await db.provider(model.providerId)).enabled ||
            model.purpose !== purpose
          ) {
            bad('请选择对应用途的已启用模型和服务商')
          }
        }
        await db.execute(`UPDATE ai_settings SET ${column}=? WHERE id=1`, [id])
        settings[field] = id
      }
      return settings
    })
  }

  async remove(kind: 'providers' | 'models', id: string) {
    await this.store.configMutation(async (db, settings) => {
      if (kind === 'models') {
        await db.model(id)
        if ([settings.modelId, settings.imageModelId].includes(id)) {
          bad('当前模型正在使用，请先切换为其他模型或停用会话模型')
        }
        await db.execute('DELETE FROM ai_models WHERE id=?', [id])
      } else {
        await db.provider(id)
        if ((await db.models()).some((m) => m.providerId === id)) {
          bad('请先删除此服务商关联的模型配置')
        }
        await db.execute('DELETE FROM ai_providers WHERE id=?', [id])
      }
    })
  }

  async runtime(purpose: 'conversation' | 'image' = 'conversation') {
    const column = purpose === 'image' ? 'image_model_id' : 'model_id'
    // One statement gives a consistent snapshot of model, provider and selection.
    const [state] = await this.store.rows<{ revision: number }>(
      'SELECT ai_revision AS revision FROM platform_configuration_state WHERE id=1',
    )
    const [row] = await this.cache.read(
      `ai-runtime-${purpose}`,
      Number(state?.revision ?? 0),
      () =>
        this.store.rows<{
          inputPrice: string
          outputPrice: string
          imagePrice: string
          contextPolicy: unknown
          modelId: string | null
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
        }>(
          `SELECT s.${column} AS modelId,m.model_id AS remoteId,m.purpose,m.invocation_mode AS invocationMode,m.input_price AS inputPrice,m.output_price AS outputPrice,m.image_price AS imagePrice,m.context_policy AS contextPolicy,m.supports_vision AS supportsVision,m.supports_reasoning AS supportsReasoning,m.enabled AS modelEnabled,p.enabled AS providerEnabled,p.id,p.base_url AS baseUrl,p.key_cipher AS keyCipher,p.revision FROM ai_settings s LEFT JOIN ai_models m ON m.id=s.${column} LEFT JOIN ai_providers p ON p.id=m.provider_id WHERE s.id=1`,
        ),
    )
    if (!row) {
      throw new ApiError(503, 'SCHEMA_REQUIRED', '请先初始化数据库')
    }
    if (!row.modelId) {
      return null
    }
    if (row.purpose !== purpose) {
      throw new ApiError(
        503,
        'MODEL_PURPOSE_MISMATCH',
        '模型用途与运行选择不一致，请在后台重新选择模型',
      )
    }
    if (!row.modelEnabled || !row.providerEnabled) {
      throw new ApiError(503, 'AI_DISABLED', '当前对话模型或服务商不可用')
    }
    const method = invocationMode(row.invocationMode, purpose)
    const policy = invocationContextPolicy(
      method,
      contextPolicy(row.contextPolicy, Boolean(row.supportsReasoning)),
    )
    return {
      configuration: await this.configuration.snapshot(),
      invocationMode: method,
      billingModelId: row.modelId,
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
      const turn = await runtime.next({
        history: [
          { role: 'user', content: 'Call connection_check with no arguments.' },
        ],
        instructions: '这是连接测试，只调用 connection_check，不执行其他操作。',
        localDate: new Date().toISOString().slice(0, 10),
        signal: AbortSignal.timeout(settingNumber(configuration, 'ai.provider.modelsTimeoutMs', 12_000)),
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
      })
      if (!turn.calls.some((item) => item.name === 'connection_check')) {
        throw new ApiError(
          502,
          'MODEL_TOOL_UNSUPPORTED',
          '模型未返回指定工具调用，请确认支持工具选择',
        )
      }
      return {
        message: `${model.invocationMode === 'chat_completions' ? 'Chat Completions' : 'Responses'} 流式响应与工具调用测试通过`,
      }
    } catch (error) {
      throw new ApiError(
        502,
        'MODEL_TEST_FAILED',
        `测试失败：${publicRunError(error).message}`,
      )
    }
  }
}
