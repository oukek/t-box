import type {
  BackendEventBatch,
  BackendEventRequest,
  BackendInvocation,
  BackendPreparation,
  BackendPreparationResult,
  LifecycleReceipt,
  LifecycleRequest,
} from '@t-box/app-contracts'
import type { ApplicationBackend } from './contracts.js'
import { ErrorCode } from '../../error-codes.js'
/** Bound by trusted deployment configuration. Credentials never enter catalog or model prompts. */
export class RemoteApplicationBackend implements ApplicationBackend {
  private readonly base: URL
  constructor(
    baseUrl: string,
    private readonly credential: string,
    private readonly timeout = 5000,
  ) {
    this.base = new URL(baseUrl)
    if (
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      (this.base.protocol !== 'https:' &&
        !(
          this.base.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname)
        ))
    ) {
      throw ErrorCode.INTERNAL_REMOTE_APPLICATIONS_REQUIRE_HTTPS_OR_LOOPBACK_DEVELOPMENT_ENDPOINT()
    }
    if (!credential) {
      throw ErrorCode.INTERNAL_REMOTE_SERVICE_CREDENTIAL_IS_REQUIRED()
    }
  }

  private async request(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(new URL(path, this.base), {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.credential}`,
      },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.timeout)])
        : AbortSignal.timeout(this.timeout),
    })
    if (!response.ok) {
      throw ErrorCode.APP_BACKEND_UNAVAILABLE()
    }
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      if (!reader) {
        throw ErrorCode.INTERNAL_EMPTY_APPLICATION_RESPONSE()
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        size += value.byteLength
        if (size > 256_000) {
          throw ErrorCode.INTERNAL_APPLICATION_RESPONSE_TOO_LARGE()
        }
        chunks.push(value)
      }
    } finally {
      await reader?.cancel().catch(() => {})
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  private receipt(value: unknown): LifecycleReceipt | null {
    if (value === null) {
      return null
    }
    if (!value || typeof value !== 'object') {
      throw ErrorCode.INTERNAL_INVALID_LIFECYCLE_RECEIPT()
    }
    const r = value as LifecycleReceipt
    if (r.status === 'pending') {
      return { status: 'pending' }
    }
    if (
      r.status === 'completed' &&
      r.receipt &&
      typeof r.receipt === 'object' &&
      !Array.isArray(r.receipt)
    ) {
      return r
    }
    if (r.status === 'rejected' && typeof r.message === 'string') {
      return { status: 'rejected', message: r.message.slice(0, 300) }
    }
    throw ErrorCode.INTERNAL_INVALID_LIFECYCLE_RECEIPT()
  }

  async lifecycle(request: LifecycleRequest) {
    return (
      this.receipt(await this.request('lifecycle/ensure', request)) ?? {
        status: 'pending' as const,
      }
    )
  }

  async operation(request: LifecycleRequest) {
    return this.receipt(await this.request('lifecycle/status', request))
  }

  async invoke(request: BackendInvocation, signal?: AbortSignal) {
    return this.request('invoke', request, signal)
  }

  async prepare(
    request: BackendPreparation,
    signal?: AbortSignal,
  ): Promise<BackendPreparationResult> {
    const value = (await this.request(
      'prepare',
      request,
      signal,
    )) as BackendPreparationResult
    const opaque = (text: unknown) =>
      typeof text === 'string' && text.length > 0 && text.length <= 4096
    if (
      value?.status === 'ready' &&
      (value.ticket === undefined || opaque(value.ticket))
    ) {
      return {
        status: 'ready',
        ...(value.ticket ? { ticket: value.ticket } : {}),
      }
    }
    if (
      value?.status === 'interaction' &&
      opaque(value.continuation) &&
      typeof value.request?.name === 'string' &&
      value.request.name.length <= 128 &&
      JSON.stringify(value.request.arguments ?? null).length <= 64_000
    ) {
      return {
        status: 'interaction',
        continuation: value.continuation,
        request: {
          name: value.request.name,
          arguments: value.request.arguments,
        },
      }
    }
    throw ErrorCode.APP_PROTOCOL_INVALID('应用交互协议无效')
  }

  async events(
    request: BackendEventRequest,
    signal?: AbortSignal,
  ): Promise<BackendEventBatch> {
    const value = (await this.request(
      'events/poll',
      request,
      signal,
    )) as BackendEventBatch
    if (
      !value ||
      typeof value.cursor !== 'string' ||
      value.cursor.length > 4096 ||
      !Array.isArray(value.events) ||
      value.events.length > 50
    ) {
      throw ErrorCode.APP_PROTOCOL_INVALID()
    }
    return { cursor: value.cursor, events: value.events }
  }
}
