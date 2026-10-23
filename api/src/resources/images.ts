import type { Actor as Principal } from '@t-box/app-server-sdk'
import type { ConfigurationService } from '../admin/service.js'
import type { ProviderConcurrency } from '../billing/concurrency.js'
import type { BillingService } from '../billing/service.js'
import type { ResourceService } from './service.js'
import { createHash, randomUUID } from 'node:crypto'
import { object, text } from '@t-box/server-foundation/input'
import OpenAI, { toFile } from 'openai'
import sharp from 'sharp'
import { money, supplierCost } from '../billing/money.js'
import { publicRunError } from '../chat/errors.js'
import { settingNumber, settingText } from '../configuration/defaults.js'
import { ErrorCode } from '../error-codes.js'
import { ModelCallAudit } from '../models/audit.js'
import { imageRequestSize, imageTier } from '../models/image-tier.js'
import { ModelRouting } from '../models/routing.js'
import { imageOutput } from './image-output.js'

export class ImageTools {
  constructor(
    readonly resources: ResourceService,
    readonly configuration?: ConfigurationService,
    readonly billing?: BillingService,
    readonly concurrency?: ProviderConcurrency,
  ) {}

  forRun(principal: Principal, signal: AbortSignal, taskId?: string) {
    const selected = new Map<import('@t-box/shared').ImageTier, ReturnType<ConfigurationService['runtime']>>()
    const prepare = async (value: unknown, edit = false) => {
      const args = object(
        value,
        edit ? ['prompt', 'resourceIds', 'tier'] : ['prompt', 'tier'],
      )
      const prompt = text(args.prompt, '图片说明', 2000)
      const tier = imageTier(args.tier)
      if (!this.configuration) {
        throw ErrorCode.IMAGE_MODEL_REQUIRED()
      }
      let runtime = selected.get(tier)
      if (!runtime) {
        runtime = this.configuration.runtime('image', { imageTier: tier }).catch((error: unknown) => {
          selected.delete(tier)
          throw error
        })
        selected.set(tier, runtime)
      }
      const config = await runtime
      if (!config) {
        selected.delete(tier)
        throw ErrorCode.IMAGE_MODEL_REQUIRED()
      }
      const inputs = edit
        ? await this.resources.attachments(principal, args.resourceIds)
        : []
      if (
        edit &&
        (!inputs.length || inputs.some((r) => !r.mimeType.startsWith('image/')))
      ) {
        throw ErrorCode.IMAGE_REQUIRED()
      }
      return {
        prompt,
        config,
        inputs,
        tier,
      }
    }
    const operation = async (
      value: unknown,
      edit = false,
      trace?: { messageId?: string, callId?: string },
    ) => {
      const { prompt, config, inputs, tier } = await prepare(value, edit)
      // Compatible providers can extend the SDK's standard size enum. The
      // administrator must explicitly configure a model for that exact tier.
      const size = imageRequestSize(tier, settingText(config.configuration, 'ai.images.size', '1024x1024')) as OpenAI.ImageGenerateParams['size']
      const operationId = randomUUID()
      const execution = {
        operationId,
        userId: principal.user.id,
        taskId,
        messageId: trace?.messageId,
        agentId: 'images',
        logicalRequestId: trace?.callId
          ? createHash('sha256')
              .update(`${taskId}:${trace.callId}`)
              .digest('hex')
              .slice(0, 32)
          : operationId,
      }
      const audit = new ModelCallAudit(this.resources.source)
      const routing = new ModelRouting(this.resources.source)
      const metadata = {
        ...config,
        modelName: config.modelName || config.model,
        providerName: config.providerName || config.providerId,
        invocationMode: 'images',
      }
      const limit = settingNumber(
        config.configuration,
        'ai.audit.maxPayloadChars',
        262144,
      )
      await audit.begin(
        { ...execution, purpose: 'image' },
        metadata,
        edit ? 'images.edit' : 'images.generate',
        { prompt, tier, size, resourceIds: inputs.map((r) => r.id) },
        limit,
      )
      let renewal: Promise<unknown> | undefined
      const heartbeat = setInterval(() => {
        renewal ??= Promise.all([
          audit.heartbeat(operationId),
          this.billing?.heartbeat(principal.user.id, operationId),
        ])
          .catch(() => {})
          .finally(() => {
            renewal = undefined
          })
      }, 25000)
      let auditError: unknown
      let generated = false
      let persisted: Awaited<ReturnType<ResourceService['create']>> | undefined
      let imageUsage: {
        inputTokens?: number
        outputTokens?: number
        providerRequestId?: string
      } = {}
      const execute = async (signal: AbortSignal) => {
        signal.throwIfAborted()
        await audit.running(operationId)
        await this.billing?.begin({
          ...execution,
          id: operationId,
          modelId: config.billingModelId,
          prices: config.prices,
          kind: 'image',
          budget: { images: 1, tier, editing: edit },
          purpose: 'response',
          reserve: supplierCost(money(config.prices.imagePrice), config.prices),
        })
        const client = new OpenAI({
          ...config,
          timeout: settingNumber(
            config.configuration,
            'ai.images.timeoutMs',
            240000,
          ),
          maxRetries: 0,
          fetch: (url, options) =>
            fetch(url, { ...options, redirect: 'error' }),
        })
        let response
        try {
          response = edit
            ? await client.images.edit(
                {
                  model: config.model,
                  prompt,
                  n: 1,
                  size,
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
                  size,
                  ...(['dall-e-2', 'dall-e-3'].includes(config.model)
                    ? { response_format: 'b64_json' as const }
                    : {}),
                },
                { signal },
              )
        } catch (error) {
          auditError = error
          await this.billing?.uncertain(principal.user.id, operationId)
          if (signal.aborted) {
            throw error
          }
          throw ErrorCode.IMAGE_PROVIDER_FAILED(
            `图片处理失败：${publicRunError(error).message}；不会自动重试`,
          )
        }
        try {
          generated = !!response?.data?.length
          const count = (value: unknown) =>
            typeof value === 'number' &&
            Number.isSafeInteger(value) &&
            value >= 0
              ? value
              : undefined
          imageUsage = {
            inputTokens: count(response?.usage?.input_tokens),
            outputTokens: count(response?.usage?.output_tokens),
            providerRequestId: response?._request_id || undefined,
          }
          const { bytes, mime } = await imageOutput(response?.data?.[0], signal)
          const dimensions = await sharp(bytes).metadata()
          const shortSide = Math.min(
            dimensions.width ?? 0,
            dimensions.height ?? 0,
          )
          const required = tier === '4k' ? 4096 : tier === '2k' ? 2048 : 1024
          if (shortSide < required) {
            throw ErrorCode.IMAGE_OUTPUT_INVALID(
              '服务商返回的图片未达到请求分辨率，本次不扣额度',
            )
          }
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
          persisted = resource
          await this.billing?.settle(principal.user.id, operationId, {
            images: 1,
            tier,
            inputTokens: imageUsage.inputTokens,
            outputTokens: imageUsage.outputTokens,
          })
          return { resources: [resource] }
        } catch (error) {
          await this.billing?.uncertain(principal.user.id, operationId)
          throw error
        }
      }
      try {
        const result = this.concurrency
          ? await this.concurrency.run(
              config.providerId,
              signal,
              await this.configuration!.configuration.snapshot(),
              execute,
              {
                id: config.billingModelId,
                maxConcurrency: config.maxConcurrency || 4,
                providerConcurrency: config.providerConcurrency || 0,
              },
            )
          : await execute(signal)
        await audit
          .finish(operationId, metadata, result, limit, {
            ...imageUsage,
            images: 1,
          })
          .catch(() => console.warn('MODEL_AUDIT_WRITE_FAILED', operationId))
        await routing.success(config.billingModelId).catch(() => {})
        return result
      } catch (error) {
        await audit
          .finish(
            operationId,
            metadata,
            {
              generated,
              persisted: !!persisted,
              resources: persisted ? [persisted] : [],
            },
            limit,
            generated ? { ...imageUsage, images: 1 } : undefined,
            auditError || error,
            signal.aborted,
          )
          .catch(() => console.warn('MODEL_AUDIT_WRITE_FAILED', operationId))
        if (!signal.aborted) {
          await routing
            .failure(
              config.billingModelId,
              auditError || error,
              config.configuration,
            )
            .catch(() => {})
        }
        throw error
      } finally {
        clearInterval(heartbeat)
        await renewal
      }
    }
    return Object.assign(operation, { prepare })
  }
}
