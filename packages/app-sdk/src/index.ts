import type {
  ApplicationBridgeError,
  ApplicationBridgeEvent,
  ApplicationContext,
  ApplicationSession,
  HostMethod,
} from '@t-box/app-contracts'
import { createApplicationRequestId } from '@t-box/app-contracts'

export type {
  ApplicationContext,
  ApplicationSession,
  HostMethod,
} from '@t-box/app-contracts'

export class AppSdkError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AppSdkError'
  }

  static from(error: unknown): AppSdkError {
    if (error instanceof AppSdkError) {
      return error
    }
    const value = error as Partial<ApplicationBridgeError> | null
    return new AppSdkError(
      typeof value?.code === 'string' ? value.code : 'REQUEST_FAILED',
      typeof value?.message === 'string' ? value.message : '应用请求失败',
      typeof value?.status === 'number' ? value.status : undefined,
    )
  }
}
export interface RequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
  /** Reuse this key after an unknown write outcome; the SDK never retries writes automatically. */
  idempotencyKey?: string
}
/** Implemented by the host adapter or the isolated MessageChannel adapter. No framework dependency. */
export interface AppTransport {
  call<T>(
    method: HostMethod,
    args: unknown,
    options?: RequestOptions,
  ): Promise<T>
  listen(listener: (event: ApplicationBridgeEvent) => void): () => void
  close(): void
}
export type AppClient = ReturnType<typeof createAppClient>
export function createAppClient(transport: AppTransport) {
  let closed = false
  const requests = new Set<AbortController>()
  const authListeners = new Set<(session: ApplicationSession) => void>()
  const closeListeners = new Set<(reason: AppSdkError) => void>()
  const interactionListeners = new Set<() => void>()
  const navigationListeners = new Set<(params: Record<string, string>) => void>()
  const subscriptions = new Map<
    string,
    {
      receive(value: unknown): void
      error?(error: AppSdkError): void
      stop(): void
    }
  >()
  const report = (callback: () => void) => {
    try {
      callback()
    } catch (error) {
      console.error('Application SDK listener failed', error)
    }
  }
  function abortRequests(reason: AppSdkError) {
    for (const controller of requests) {
      controller.abort(reason)
    }
  }
  const stopListening = transport.listen((event) => {
    if (closed) {
      return
    }
    if (event.name === 'auth.changed') {
      const reason = new AppSdkError(
        'SESSION_CHANGED',
        '登录状态已改变，请重新操作',
      )
      abortRequests(reason)
      for (const subscription of subscriptions.values()) {
        if (subscription.error) {
          report(() => subscription.error!(reason))
        }
        subscription.stop()
      }
      for (const listener of authListeners) {
        report(() => listener(event.data as ApplicationSession))
      }
    } else if (event.name === 'runtime.navigation') {
      for (const listener of navigationListeners) {
        report(() => listener(event.data as Record<string, string>))
      }
    } else if (event.name === 'runtime.interactions.cancelled') {
      for (const listener of interactionListeners) {
        report(listener)
      }
    } else if (event.name === 'runtime.closed') {
      dispose(AppSdkError.from(event.data))
    } else {
      const data = event.data as {
        subscriptionId: string
        value?: unknown
        error?: unknown
      }
      const subscription = subscriptions.get(data?.subscriptionId)
      if (!subscription) {
        return
      }
      if (event.name === 'app.event') {
        report(() => subscription.receive(data.value))
      } else if (subscription.error) {
        report(() => subscription.error!(AppSdkError.from(data.error)))
      }
    }
  })
  function dispose(reason = new AppSdkError('APP_CLOSED', '应用已关闭')) {
    if (closed) {
      return
    }
    closed = true
    abortRequests(reason)
    stopListening()
    transport.close()
    for (const listener of closeListeners) {
      report(() => listener(reason))
    }
    authListeners.clear()
    closeListeners.clear()
    interactionListeners.clear()
    navigationListeners.clear()
    for (const subscription of subscriptions.values()) {
      subscription.stop()
    }
    subscriptions.clear()
  }
  async function call<T>(
    method: HostMethod,
    args: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    if (closed) {
      throw new AppSdkError('APP_CLOSED', '应用已关闭')
    }
    const timeoutMs = options.timeoutMs ?? 15000
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
      throw new AppSdkError('INVALID_TIMEOUT', '请求超时时间无效')
    }
    const controller = new AbortController()
    requests.add(controller)
    const abort = () =>
      controller.abort(new AppSdkError('REQUEST_CANCELLED', '请求已取消'))
    const signal = options.signal
    if (signal?.aborted) {
      abort()
    } else {
      signal?.addEventListener('abort', abort, { once: true })
    }
    let rejectAbort!: (reason: unknown) => void
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    const rejected = () => rejectAbort(controller.signal.reason)
    controller.signal.addEventListener('abort', rejected, { once: true })
    const timer = setTimeout(
      () =>
        controller.abort(
          new AppSdkError('REQUEST_TIMEOUT', '请求超时；写入结果可能尚待确认'),
        ),
      timeoutMs,
    )
    try {
      controller.signal.throwIfAborted()
      return await Promise.race([
        transport.call<T>(method, args, {
          ...options,
          signal: controller.signal,
        }),
        cancelled,
      ])
    } catch (error) {
      throw AppSdkError.from(error)
    } finally {
      clearTimeout(timer)
      requests.delete(controller)
      signal?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', rejected)
    }
  }
  return {
    auth: {
      getSession: () => call<ApplicationSession>('auth.session', {}),
      async ensureSignedIn() {
        const session = await call<ApplicationSession>('auth.session', {})
        if (session.status !== 'signed_in') {
          throw new AppSdkError(
            'AUTH_REQUIRED',
            '请在宿主中登录后使用应用',
            401,
          )
        }
        return session
      },
      onChange(listener: (session: ApplicationSession) => void) {
        if (closed) {
          throw new AppSdkError('APP_CLOSED', '应用已关闭')
        }
        authListeners.add(listener)
        return () => {
          authListeners.delete(listener)
        }
      },
    },
    api: {
      mutate<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
        return call<T>('api.request', { path, method, body, stable: true })
      },
      request<T>(path: string, input: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', body?: unknown } = {}, options?: RequestOptions) {
        return call<T>('api.request', { path, ...input }, options)
      },
      invoke<T>(method: string, args: unknown, options?: RequestOptions) {
        return call<T>('api.invoke', { method, arguments: args }, options)
      },
    },
    device: {
      reminders<T = unknown>(action: 'status' | 'sync' | 'enable' | 'exact') {
        return call<T>('device.reminders', { action }, { timeoutMs: 120_000 })
      },
    },
    resources: {
      async setBindings(bindings: { appId: string, resourceType: string, resourceId: string }[]) {
        await call('resources.bindings', { bindings })
      },
    },
    permissions: {
      async list() {
        return (await call<ApplicationContext>('runtime.context', {}))
          .permissions
      },
      async has(permission: string) {
        return (
          await call<ApplicationContext>('runtime.context', {})
        ).permissions.includes(permission)
      },
    },
    storage: {
      get<T>(key: string) {
        return call<T | null>('storage.get', { key })
      },
      async set(key: string, value: unknown) {
        await call('storage.set', { key, value })
      },
      async remove(key: string) {
        await call('storage.remove', { key })
      },
    },
    navigation: {
      async back() {
        await call('navigation.back', {})
      },
      async open(params: Record<string, string> = {}) {
        await call('navigation.open', { params })
      },
    },
    events: {
      async subscribe<T>(
        channel: string,
        args: unknown,
        receive: (value: T) => void,
        options: {
          signal?: AbortSignal
          onError?: (error: AppSdkError) => void
        } = {},
      ) {
        const subscriptionId = createApplicationRequestId()
        let stopped = false
        const stop = () => {
          if (stopped) {
            return
          }
          stopped = true
          options.signal?.removeEventListener('abort', stop)
          subscriptions.delete(subscriptionId)
          if (!closed) {
            void call('events.unsubscribe', { subscriptionId }).catch(() => {})
          }
        }
        subscriptions.set(subscriptionId, {
          receive: receive as (v: unknown) => void,
          error: options.onError,
          stop,
        })
        try {
          await call(
            'events.subscribe',
            { subscriptionId, channel, arguments: args },
            { signal: options.signal },
          )
          if (options.signal?.aborted) {
            stop()
          } else {
            options.signal?.addEventListener('abort', stop, { once: true })
          }
          return stop
        } catch (error) {
          stop()
          throw error
        }
      },
    },
    runtime: {
      onNavigate(listener: (params: Record<string, string>) => void) {
        navigationListeners.add(listener)
        return () => navigationListeners.delete(listener)
      },
      onInteractionCancel(listener: () => void) {
        interactionListeners.add(listener)
        return () => interactionListeners.delete(listener)
      },
      getContext: () => call<ApplicationContext>('runtime.context', {}),
      async supports(capability: HostMethod) {
        return (
          await call<ApplicationContext>('runtime.context', {})
        ).capabilities.includes(capability)
      },
      onClose(listener: (reason: AppSdkError) => void) {
        if (closed) {
          throw new AppSdkError('APP_CLOSED', '应用已关闭')
        }
        closeListeners.add(listener)
        return () => {
          closeListeners.delete(listener)
        }
      },
    },
    dispose,
  }
}
