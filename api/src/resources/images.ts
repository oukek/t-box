import type { Actor as Principal } from '@t-box/app-server-sdk'
import type { ConfigurationService } from '../admin/service.js'
import type { ProviderConcurrency } from '../billing/concurrency.js'
import type { BillingService } from '../billing/service.js'
import type { ResourceService } from './service.js'
import { randomUUID } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'
import { object, text } from '@t-box/server-foundation/input'
import OpenAI, { toFile } from 'openai'
import { money } from '../billing/money.js'
import { publicRunError } from '../chat/errors.js'
import { settingNumber, settingText } from '../configuration/defaults.js'
import { imageOutput } from './image-output.js'

export class ImageTools {
  constructor(
    readonly resources: ResourceService,
    readonly configuration?: ConfigurationService,
    readonly billing?: BillingService,
    readonly concurrency?: ProviderConcurrency,
  ) {}

  forRun(principal: Principal, signal: AbortSignal, taskId?: string) {
    let selected: ReturnType<ConfigurationService['runtime']> | undefined
    const prepare = async (value: unknown, edit = false) => {
      const args = object(value, edit ? ['prompt', 'resourceIds'] : ['prompt'])
      const prompt = text(args.prompt, '图片说明', 2000)
      if (!this.configuration) {
        throw new ApiError(
          503,
          'IMAGE_MODEL_REQUIRED',
          '请在后台配置图片生成/编辑模型',
        )
      }
      selected ||= this.configuration.runtime('image')
      const config = await selected
      if (!config) {
        throw new ApiError(
          503,
          'IMAGE_MODEL_REQUIRED',
          '请在后台配置图片生成/编辑模型',
        )
      }
      const inputs = edit
        ? await this.resources.attachments(principal, args.resourceIds)
        : []
      if (
        edit &&
        (!inputs.length || inputs.some((r) => !r.mimeType.startsWith('image/')))
      ) {
        throw new ApiError(
          400,
          'IMAGE_REQUIRED',
          '编辑需要 1–4 张可访问的图片',
        )
      }
      return { prompt, config, inputs }
    }
    const operation = async (value: unknown, edit = false) => {
      const { prompt, config, inputs } = await prepare(value, edit)
      const execute = async (signal: AbortSignal) => {
        signal.throwIfAborted()
        const operationId = randomUUID()
        await this.billing?.begin({
          id: operationId,
          userId: principal.user.id,
          taskId,
          modelId: config.billingModelId,
          prices: config.prices,
          kind: 'image',
          reserve: money(config.prices.imagePrice),
        })
        const client = new OpenAI({
          ...config,
          timeout: settingNumber(
            config.configuration,
            'ai.images.timeoutMs',
            240000,
          ),
          maxRetries: 0,
          fetch: (url, options) => fetch(url, { ...options, redirect: 'error' }),
        })
        let response
        try {
          response = edit
            ? await client.images.edit(
                {
                  model: config.model,
                  prompt,
                  n: 1,
                  size: settingText(
                    config.configuration,
                    'ai.images.size',
                    '1024x1024',
                  ) as '1024x1024',
                  image: await Promise.all(
                    inputs.map(async (r) =>
                      toFile(
                        (await this.resources.bytes(principal, r.id)).bytes,
                        r.name,
                        { type: r.mimeType },
                      ),
                    ),
                  ),
                },
                { signal },
              )
            : await client.images.generate(
                {
                  model: config.model,
                  prompt,
                  n: 1,
                  size: settingText(
                    config.configuration,
                    'ai.images.size',
                    '1024x1024',
                  ) as '1024x1024',
                  ...(['dall-e-2', 'dall-e-3'].includes(config.model)
                    ? { response_format: 'b64_json' as const }
                    : {}),
                },
                { signal },
              )
        } catch (error) {
          await this.billing?.uncertain(principal.user.id, operationId)
          if (signal.aborted) {
            throw error
          }
          throw new ApiError(
            502,
            'IMAGE_PROVIDER_FAILED',
            `图片处理失败：${publicRunError(error).message}；不会自动重试`,
          )
        }
        try {
          const { bytes, mime } = await imageOutput(response?.data?.[0], signal)
          const extension =
            mime === 'image/jpeg'
              ? 'jpg'
              : mime === 'image/webp'
                ? 'webp'
                : 'png'
          const resource = await this.resources.create(
            principal,
            `图片${edit ? '编辑' : '生成'}-${Date.now()}.${extension}`,
            bytes,
            'generated',
          )
          await this.billing?.settle(principal.user.id, operationId, {
            images: 1,
          })
          return { resources: [resource] }
        } catch (error) {
          await this.billing?.uncertain(principal.user.id, operationId)
          throw error
        }
      }
      return this.concurrency ? this.concurrency.run(config.providerId, signal, await this.configuration!.configuration.snapshot(), execute) : execute(signal)
    }
    return Object.assign(operation, { prepare })
  }
}
