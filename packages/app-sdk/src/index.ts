import type {
  ApplicationBridgeEvent,
  ApplicationContext,
  ApplicationFile,
  ApplicationFileContent,
  ApplicationSession,
  ApplicationUpdateInfo,
  FilePickOptions,
  HostMethod,
  PrivateFileScope,
} from '@t-box/app-contracts'
import {
  APPLICATION_FILE_MAX_BYTES,
  createApplicationRequestId,
} from '@t-box/app-contracts'
import { SdkErrorCode } from './error-codes.js'
import { AppSdkError } from './sdk-error.js'

export { SdkErrorCode } from './error-codes.js'

export { AppSdkError } from './sdk-error.js'

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
  let updateHandler:
    | {
      id: string
      show(
        update: ApplicationUpdateInfo,
        options: { signal: AbortSignal },
      ): boolean | void | Promise<boolean | void>
    } |
    undefined
  let updateAbort: AbortController | undefined
  const requests = new Set<AbortController>()
  const authListeners = new Set<(session: ApplicationSession) => void>()
  const closeListeners = new Set<(reason: AppSdkError) => void>()
  const interactionListeners = new Set<() => void>()
  const navigationListeners = new Set<
    (params: Record<string, string>) => void
  >()
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
    if (event.name === 'runtime.update') {
      const data = event.data as {
        promptId: string
        update: ApplicationUpdateInfo | null
      }
      updateAbort?.abort()
      updateAbort = undefined
      if (!data.update || !updateHandler) {
        return
      }
      const handler = updateHandler
      const abort = new AbortController()
      updateAbort = abort
      void Promise.resolve()
        .then(() => {
          if (closed || abort.signal.aborted || updateHandler !== handler) {
            return false
          }
          return handler.show(data.update!, { signal: abort.signal })
        })
        .then(
          (result) => result !== false,
          () => false,
        )
        .then((shown) => {
          if (!closed && !abort.signal.aborted && updateHandler === handler) {
            return call('updates.respond', { promptId: data.promptId, shown })
          }
        })
        .catch(() => {})
    } else if (event.name === 'auth.changed') {
      updateAbort?.abort()
      updateHandler = undefined
      const reason = SdkErrorCode.SESSION_CHANGED()
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
  function dispose(reason = SdkErrorCode.APP_CLOSED()) {
    if (closed) {
      return
    }
    closed = true
    updateAbort?.abort()
    updateHandler = undefined
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
      throw SdkErrorCode.APP_CLOSED()
    }
    const timeoutMs = options.timeoutMs ?? 15000
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
      throw SdkErrorCode.INVALID_TIMEOUT()
    }
    const controller = new AbortController()
    requests.add(controller)
    const abort = () => controller.abort(SdkErrorCode.REQUEST_CANCELLED())
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
      () => controller.abort(SdkErrorCode.REQUEST_TIMEOUT()),
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
          throw SdkErrorCode.AUTH_REQUIRED(undefined, 401)
        }
        return session
      },
      onChange(listener: (session: ApplicationSession) => void) {
        if (closed) {
          throw SdkErrorCode.APP_CLOSED()
        }
        authListeners.add(listener)
        return () => {
          authListeners.delete(listener)
        }
      },
    },
    api: {
      mutate<T>(
        path: string,
        method: 'POST' | 'PATCH' | 'DELETE',
        body: unknown,
      ) {
        return call<T>('api.request', { path, method, body, stable: true })
      },
      request<T>(
        path: string,
        input: {
          method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'
          body?: unknown
        } = {},
        options?: RequestOptions,
      ) {
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
      async setBindings(
        bindings: { appId: string, resourceType: string, resourceId: string }[],
      ) {
        await call('resources.bindings', { bindings })
      },
    },
    files: {
      private: {
        pick(scope: PrivateFileScope, options: FilePickOptions = {}, request: RequestOptions = {}) {
          return call<ApplicationFile[]>('files.private.pick', { scope, options }, { timeoutMs: 120000, ...request })
        },
        async upload(scope: PrivateFileScope, file: Blob & { name?: string }, request: RequestOptions = {}) {
          if (!file.size || file.size > APPLICATION_FILE_MAX_BYTES) {
            throw SdkErrorCode.FILE_SIZE()
          }
          const bytes = new Uint8Array(await file.arrayBuffer())
          let binary = ''
          for (let offset = 0; offset < bytes.length; offset += 32768) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
          }
          return call<ApplicationFile>('files.private.upload', { scope, file: { name: file.name || '未命名文件', base64: btoa(binary) } }, { timeoutMs: 120000, ...request })
        },
        async read(id: string, options: { original?: boolean } = {}, request: RequestOptions = {}) {
          const content = await call<ApplicationFileContent>('files.private.read', { id, original: options.original === true }, { timeoutMs: 60000, ...request })
          const bytes = Uint8Array.from(atob(content.base64), (char) => char.charCodeAt(0))
          return { file: content.file, blob: new Blob([bytes], { type: content.file.mimeType }) }
        },
      },
      /** Call from a user gesture. The host picker never exposes the account's entire library. */
      pick(options: FilePickOptions = {}, request: RequestOptions = {}) {
        return call<ApplicationFile[]>('files.pick', options, {
          timeoutMs: 120000,
          ...request,
        })
      },
      async upload(
        file: Blob & { name?: string },
        request: RequestOptions = {},
      ) {
        if (!file.size || file.size > APPLICATION_FILE_MAX_BYTES) {
          throw SdkErrorCode.FILE_SIZE()
        }
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 32768) {
          binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + 32768),
          )
        }
        return call<ApplicationFile>(
          'files.upload',
          { name: file.name || '未命名文件', base64: btoa(binary) },
          { timeoutMs: 120000, ...request },
        )
      },
      async read(id: string, request: RequestOptions = {}) {
        const content = await call<ApplicationFileContent>(
          'files.read',
          { id },
          { timeoutMs: 60000, ...request },
        )
        const binary = atob(content.base64)
        const bytes = Uint8Array.from(binary, (character) =>
          character.charCodeAt(0))
        return {
          file: content.file,
          blob: new Blob([bytes], { type: content.file.mimeType }),
        }
      },
    },
    updates: {
      getAvailable: () =>
        call<ApplicationUpdateInfo | null>('updates.getAvailable', {}),
      async openMarket() {
        await call('updates.openMarket', {})
      },
      /**
       * Return false or throw for the host fallback. Resolve only after custom UI is visible.
       * Close custom UI when signal aborts (timeout, navigation or session change).
       */
      async registerPrompt(
        show: (
          update: ApplicationUpdateInfo,
          options: { signal: AbortSignal },
        ) => boolean | void | Promise<boolean | void>,
      ) {
        if (updateHandler) {
          throw SdkErrorCode.UPDATE_PROMPT_REGISTERED()
        }
        const handler = { id: createApplicationRequestId(), show }
        updateHandler = handler
        const stop = () => {
          if (updateHandler !== handler) {
            return
          }
          updateAbort?.abort()
          updateHandler = undefined
          if (!closed) {
            void call('updates.presentation', {
              registrationId: handler.id,
              enabled: false,
            }).catch(() => {})
          }
        }
        try {
          await call('updates.presentation', {
            registrationId: handler.id,
            enabled: true,
          })
          return stop
        } catch (error) {
          stop()
          throw error
        }
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
          throw SdkErrorCode.APP_CLOSED()
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

export type {
  ApplicationContext,
  ApplicationSession,
  ApplicationUpdateInfo,
  ApplicationUpdatePrompt,
  HostMethod,
} from '@t-box/app-contracts'
