import type { DataSource } from 'typeorm'
import type { ProviderInput, ProviderUsage } from '../chat/provider.js'
import { In, Raw } from 'typeorm'
import { publicRunError, runErrorDiagnostics } from '../chat/errors.js'
import { AiModelCallEntity } from '../db/records/models-entities.js'

/** Secrets and binary resources are excluded even when providers echo them in free-form errors. */
export function auditPayload(
  value: unknown,
  secrets: string[] = [],
  limit = 262144,
): string {
  let remaining = limit
  const text = (value: string) => {
    let result = value
    for (const secret of secrets) {
      if (secret) {
        result = result.split(secret).join('[credential omitted]')
      }
    }
    result = result
      .replace(/data:[^\s"']+;base64,[a-z0-9+/=]+/gi, '[binary omitted]')
      .replace(/Bearer\s+[\w.+/=-]+/gi, 'Bearer [credential omitted]')
      .replace(/\bsk-[\w-]{8,}\b/gi, '[credential omitted]')
      .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[credentials omitted]@')
      .replace(
        /([?&](?:token|signature|x-oss-signature|x-amz-signature|api_key|access_token|key|authorization)=)[^\s&#"']+/gi,
        '$1[credential omitted]',
      )
    if (result.length > remaining) {
      const shortened = result.slice(0, Math.max(0, remaining)) + '…[truncated]'
      remaining = 0
      return shortened
    }
    remaining -= result.length
    return result
  }
  const seen = new WeakSet<object>()
  const clean = (value: unknown, depth = 0): unknown => {
    if (remaining <= 0) {
      return '[truncated]'
    }
    if (typeof value === 'string') {
      if (value.length < 1048576 && /^[[{]/.test(value.trim())) {
        try {
          return clean(JSON.parse(value), depth + 1)
        } catch {
          /* Ordinary text. */
        }
      }
      return text(value)
    }
    if (value === null || typeof value !== 'object') {
      return typeof value === 'bigint' ? value.toString() : value
    }
    if (depth > 24 || seen.has(value)) {
      return '[depth/cycle omitted]'
    }
    seen.add(value)
    if (Array.isArray(value)) {
      return value.slice(0, 2048).map((item) => clean(item, depth + 1))
    }
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 256)
        .map(([key, value]) => [
          key,
          /^(?:password|passwd|token|accessToken|refreshToken|resourceToken|unlockToken|consentToken|authToken|sessionHash|apiKey|xApiKey|authorization|cookie|secret|clientSecret|keyCipher|encryptedContent|imageUrl|b64Json|base64|fileData)$/i.test(
            key.replace(/[_-]/g, ''),
          )
            ? '[credential/binary omitted]'
            : clean(value, depth + 1),
        ]),
    )
  }
  const serialized = JSON.stringify(clean(value)) ?? 'null'
  return serialized.length <= limit + 2048
    ? serialized
    : JSON.stringify({ truncated: true, preview: serialized.slice(0, limit) })
}
export interface ModelAuditMetadata {
  billingModelId: string
  providerId: string
  modelName: string
  providerName: string
  model: string
  invocationMode: string
  apiKey?: string
}
export type ModelAuditExecution = Omit<
  NonNullable<ProviderInput['execution']>,
  'purpose'
> & { purpose?: string }
export class ModelCallAudit {
  constructor(readonly source: DataSource) {}

  async begin(
    execution: ModelAuditExecution,
    model: ModelAuditMetadata,
    method: string,
    payload: unknown,
    limit: number,
  ) {
    await this.source.getRepository(AiModelCallEntity).insert({
      id: execution.operationId,
      logical_id: execution.logicalRequestId || execution.operationId,
      retry_index: execution.retryIndex || 0,
      task_id: execution.taskId || null,
      message_id: execution.messageId || null,
      user_id: execution.userId,
      provider_id: model.providerId,
      provider_name: model.providerName,
      model_id: model.billingModelId,
      model_name: model.modelName,
      remote_model: model.model,
      invocation_mode: model.invocationMode,
      purpose: execution.purpose || 'response',
      method,
      status: 'queued',
      input_json: auditPayload(payload, [model.apiKey || ''], limit),
      created_at: () => 'UTC_TIMESTAMP(3)',
      lease_until: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND)',
    })
  }

  async running(id: string) {
    await this.source.getRepository(AiModelCallEntity).update(
      { id, status: 'queued' },
      {
        status: 'running',
        started_at: () => 'UTC_TIMESTAMP(3)',
        queue_ms: () =>
          'LEAST(4294967295,GREATEST(0,TIMESTAMPDIFF(MICROSECOND,created_at,UTC_TIMESTAMP(3))/1000))',
      },
    )
  }

  heartbeat(id: string) {
    return this.source
      .getRepository(AiModelCallEntity)
      .update(
        { id, status: In(['queued', 'running']) },
        { lease_until: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND)' },
      )
  }

  async finish(
    id: string,
    model: ModelAuditMetadata,
    result: unknown,
    limit: number,
    usage?: Partial<ProviderUsage> & {
      images?: number
      providerRequestId?: string
    },
    error?: unknown,
    aborted = false,
  ) {
    const diagnostics = error
      ? {
          ...runErrorDiagnostics(error),
          cause: error instanceof Error ? error.message : String(error),
        }
      : undefined
    await this.source.getRepository(AiModelCallEntity).update(
      { id },
      {
        status: error ? (aborted ? 'cancelled' : 'failed') : 'succeeded',
        output_json: auditPayload(result, [model.apiKey || ''], limit),
        user_error: error
          ? String(
              JSON.parse(
                auditPayload(
                  publicRunError(error).message,
                  [model.apiKey || ''],
                  4096,
                ),
              ),
            ).slice(0, 500)
          : null,
        diagnostics_json: diagnostics
          ? auditPayload(diagnostics, [model.apiKey || ''], 8192)
          : null,
        provider_request_id:
          usage?.providerRequestId?.slice(0, 256) ||
          runErrorDiagnostics(error).providerRequestId ||
          null,
        response_id: usage?.responseId?.slice(0, 256) || null,
        input_tokens: usage?.inputTokens ?? null,
        output_tokens: usage?.outputTokens ?? null,
        cached_tokens: usage?.cachedInputTokens ?? null,
        reasoning_tokens: usage?.reasoningTokens ?? null,
        images: usage?.images ?? null,
        finished_at: () => 'UTC_TIMESTAMP(3)',
        duration_ms: () =>
          'LEAST(4294967295,GREATEST(0,TIMESTAMPDIFF(MICROSECOND,created_at,UTC_TIMESTAMP(3))/1000))',
      },
    )
  }

  async recover() {
    const rows: { id: string }[] = await this.source
      .getRepository(AiModelCallEntity)
      .find({
        select: { id: true },
        where: {
          status: In(['queued', 'running']),
          lease_until: Raw((column) => `${column} < UTC_TIMESTAMP(3)`),
        },
        order: { lease_until: 'ASC', id: 'ASC' },
        take: 256,
      })
    for (const { id } of rows) {
      await this.source.getRepository(AiModelCallEntity).update(
        {
          id,
          status: In(['queued', 'running']),
          lease_until: Raw((column) => `${column} < UTC_TIMESTAMP(3)`),
        },
        {
          status: 'interrupted',
          finished_at: () => 'UTC_TIMESTAMP(3)',
          duration_ms: () =>
            'LEAST(4294967295,GREATEST(0,TIMESTAMPDIFF(MICROSECOND,created_at,UTC_TIMESTAMP(3))/1000))',
          user_error: '请求执行已中断，用量及结果需要核对',
          diagnostics_json: '{"internalCode":"CALL_LEASE_EXPIRED"}',
        },
      )
    }
  }
}
