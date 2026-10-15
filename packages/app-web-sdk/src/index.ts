import type { ApplicationBridgeEvent, ApplicationContext, BridgeRequest, BridgeResponse, HostMethod } from '@t-box/app-contracts'
import type { AppTransport, RequestOptions } from '@t-box/app-sdk'
import {
  APP_PROTOCOL,
  APP_SDK_VERSION,
  applicationPayloadLimit,
  createApplicationRequestId,
} from '@t-box/app-contracts'
import {
  AppSdkError,
  createAppClient,
} from '@t-box/app-sdk'

export interface WebContext {
  subject: string
  appId: string
  releaseId: string
  generation: number
  params: Record<string, string>
}
/** No host token, cookies, model credentials or native plugin handle crosses this boundary. */
export function connectApplication(
  handlers: Record<string, (args: unknown) => unknown | Promise<unknown>>,
): Promise<{
  context: WebContext
  call<T>(
    method: HostMethod,
    args: unknown,
    options?: RequestOptions,
  ): Promise<T>
  listen(listener: (event: ApplicationBridgeEvent) => void): () => void
  ready(): void
  close(): void
}> {
  return new Promise((resolve, reject) => {
    const advertisedOrigin = new URLSearchParams(location.hash.slice(1)).get(
      'tbox-host',
    )
    const referrerOrigin = document.referrer
      ? new URL(document.referrer).origin
      : null
    // Self reloads (including Vite HMR) may use the app itself as referrer.
    // The handshake still verifies the actual parent window AND its advertised origin.
    const expectedOrigin =
      referrerOrigin && referrerOrigin !== 'null' && referrerOrigin !== location.origin
        ? referrerOrigin
        : advertisedOrigin
    if (
      !expectedOrigin ||
      (advertisedOrigin && advertisedOrigin !== expectedOrigin)
    ) {
      reject(new Error('应用宿主来源无效'))
      return
    }
    const timer = setTimeout(() => {
      // eslint-disable-next-line ts/no-use-before-define -- The timeout runs after accept is initialized and registered.
      window.removeEventListener('message', accept)
      reject(new Error('应用宿主连接超时'))
    }, 15000)
    const accept = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin !== expectedOrigin ||
        event.data?.type !== 'tbox.connect' ||
        event.data.protocol !== APP_PROTOCOL ||
        typeof event.data.nonce !== 'string' ||
        event.ports.length !== 1
      ) {
        return
      }
      window.removeEventListener('message', accept)
      clearTimeout(timer)
      const port = event.ports[0]!
      const pending = new Map<
        string,
        {
          resolve(v: unknown): void
          reject(e: Error): void
          timer: ReturnType<typeof setTimeout>
          cleanup(): void
        }
      >()
      let closed = false
      const listeners = new Set<(event: ApplicationBridgeEvent) => void>()
      port.onmessage = async ({
        data,
      }: MessageEvent<
        BridgeRequest | BridgeResponse | ApplicationBridgeEvent
      >) => {
        if (!data || closed) {
          return
        }
        if (data.type === 'event') {
          for (const listener of listeners) {
            listener(data)
          }
          return
        }
        if (typeof data.id !== 'string') {
          return
        }
        if (data.type === 'response') {
          const wait = pending.get(data.id)
          if (!wait) {
            return
          }
          clearTimeout(wait.timer)
          wait.cleanup()
          pending.delete(data.id)
          if (data.ok) {
            wait.resolve(data.data)
          } else {
            wait.reject(
              AppSdkError.from(
                data.failure ?? new Error(data.error || '请求失败'),
              ),
            )
          }
        } else if (data.type === 'request') {
          const handler = Object.hasOwn(handlers, data.method)
            ? handlers[data.method]
            : undefined
          try {
            if (!handler) {
              throw new Error('应用未提供该工具')
            }
            port.postMessage({
              type: 'response',
              id: data.id,
              ok: true,
              data: await handler(data.args),
            })
          } catch (e) {
            port.postMessage({
              type: 'response',
              id: data.id,
              ok: false,
              error: e instanceof Error ? e.message : '执行失败',
            })
          }
        }
      }
      resolve({
        context: Object.freeze(event.data.context),
        listen(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        ready() {
          if (!closed) {
            port.postMessage({
              type: 'ready',
              nonce: event.data.nonce,
              tools: Object.keys(handlers),
            })
          }
        },
        call<T>(
          method: HostMethod,
          args: unknown,
          options: RequestOptions = {},
        ): Promise<T> {
          if (closed) {
            return Promise.reject(new AppSdkError('APP_CLOSED', '应用已关闭'))
          }
          if (options.signal?.aborted) {
            return Promise.reject(
              new AppSdkError('REQUEST_CANCELLED', '请求已取消'),
            )
          }
          return new Promise<T>((resolveCall, rejectCall) => {
            const serialized = JSON.stringify(args)
            if (!serialized || serialized.length > applicationPayloadLimit(method)) {
              throw new Error('应用请求参数无效或过大')
            }
            const payload = JSON.parse(serialized)
            const id = createApplicationRequestId()
            const timer = setTimeout(() => {
              pending.get(id)?.cleanup()
              pending.delete(id)
              rejectCall(new AppSdkError('REQUEST_TIMEOUT', '请求超时'))
            }, options.timeoutMs ?? 15000)
            const abort = () => {
              clearTimeout(timer)
              pending.get(id)?.cleanup()
              pending.delete(id)
              rejectCall(new AppSdkError('REQUEST_CANCELLED', '请求已取消'))
            }
            options.signal?.addEventListener('abort', abort, { once: true })
            pending.set(id, {
              resolve: resolveCall as (v: unknown) => void,
              reject: rejectCall,
              timer,
              cleanup: () =>
                options.signal?.removeEventListener('abort', abort),
            })
            try {
              port.postMessage({
                type: 'request',
                id,
                method,
                args: payload,
                options: {
                  idempotencyKey: options.idempotencyKey,
                  timeoutMs: options.timeoutMs,
                },
              })
            } catch (error) {
              clearTimeout(timer)
              pending.get(id)?.cleanup()
              pending.delete(id)
              rejectCall(AppSdkError.from(error))
            }
          })
        },
        close() {
          closed = true
          listeners.clear()
          port.close()
          for (const p of pending.values()) {
            clearTimeout(p.timer)
            p.cleanup()
            p.reject(new Error('应用已关闭'))
          }
          pending.clear()
        },
      })
    }
    window.addEventListener('message', accept)
  })
}

/** Recommended app entry point. The public client is identical to the embedded adapter. */
export async function connectAppClient(
  handlers: Record<string, (args: unknown) => unknown | Promise<unknown>> = {},
) {
  const connection = await connectApplication(handlers)
  const client = createAppClient(connection satisfies AppTransport)
  try {
    const context = await client.runtime.getContext()
    if (context.sdkVersion !== APP_SDK_VERSION) {
      throw new AppSdkError('PROTOCOL_MISMATCH', '应用 SDK 协议不兼容')
    }
    return {
      client,
      context: context as ApplicationContext,
      ready: () => connection.ready(),
    }
  } catch (error) {
    client.dispose()
    throw error
  }
}
