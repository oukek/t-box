import type {
  BackendEventBatch,
  BackendEventRequest,
  BackendInvocation,
  BackendPreparation,
  BackendPreparationResult,
  LifecycleReceipt,
  LifecycleRequest,
} from '@t-box/app-contracts'

export interface ApplicationBackend {
  lifecycle(request: LifecycleRequest): Promise<LifecycleReceipt>
  operation(request: LifecycleRequest): Promise<LifecycleReceipt | null>
  invoke(request: BackendInvocation, signal?: AbortSignal): Promise<unknown>
  /** Non-mutating preflight. Must bind tickets to invocation ID, subject, release and generation. */
  prepare?(request: BackendPreparation, signal?: AbortSignal): Promise<BackendPreparationResult>
  /** App-owned ordered cursor stream. Enforce membership and avoid sensitive event payloads. */
  events?(request: BackendEventRequest, signal?: AbortSignal): Promise<BackendEventBatch>
}
/** Portable HTTP boundary for independently deployed services. The backend must persist operation receipts and generation fences in its own database. */
export function createApplicationBackendHandler(options: {
  credential: string
  appId: string
  backend: ApplicationBackend
}) {
  if (!options.credential) {
    throw new Error('Service credential is required')
  }
  return async (request: Request): Promise<Response> => {
    if (
      request.method !== 'POST' ||
      request.headers.get('authorization') !== `Bearer ${options.credential}`
    ) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const path = new URL(request.url).pathname
    if (!['/lifecycle/ensure', '/lifecycle/status', '/invoke', '/prepare', '/events/poll'].includes(path)) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    const body = await request.text()
    if (body.length > 64000) {
      return Response.json({ error: 'Too large' }, { status: 413 })
    }
    try {
      const value = JSON.parse(body)
      if (path === '/prepare') {
        const invocation = value?.invocation
        if (!invocation || invocation.appId !== options.appId || !/^[a-f0-9]{64}$/.test(invocation.subject) || !Number.isSafeInteger(invocation.generation) || invocation.generation < 1 || typeof invocation.releaseId !== 'string' || typeof invocation.invocationId !== 'string' || typeof invocation.method !== 'string' || !options.backend.prepare) {
          return Response.json({ error: 'Invalid preparation or unsupported protocol' }, { status: 400 })
        }
        return Response.json(await options.backend.prepare(value, request.signal))
      }
      if (
        value.appId !== options.appId ||
        typeof value.subject !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.subject) ||
        !Number.isSafeInteger(value.generation) ||
        value.generation < 1 ||
        typeof value.releaseId !== 'string'
      ) {
        return Response.json({ error: 'Invalid invocation' }, { status: 400 })
      }
      if (path === '/events/poll') {
        if (typeof value.channel !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(value.channel) || !options.backend.events) {
          return Response.json({ error: 'Unsupported event channel' }, { status: 400 })
        }
        return Response.json(await options.backend.events(value, request.signal))
      }
      if (path === '/invoke') {
        if (
          typeof value.invocationId !== 'string' ||
          typeof value.method !== 'string'
        ) {
          return Response.json(
            { error: 'Invalid invocation' },
            { status: 400 },
          )
        }
        return Response.json(
          await options.backend.invoke(value, request.signal),
        )
      }
      if (
        typeof value.operationId !== 'string' ||
        !['install', 'update', 'uninstall'].includes(value.action)
      ) {
        return Response.json({ error: 'Invalid lifecycle' }, { status: 400 })
      }
      return Response.json(
        path === '/lifecycle/status'
          ? await options.backend.operation(value)
          : await options.backend.lifecycle(value),
      )
    } catch {
      return Response.json(
        { error: 'Application service failed' },
        { status: 500 },
      )
    }
  }
}
