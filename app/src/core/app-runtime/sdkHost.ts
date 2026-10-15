import type {
  ApplicationBridgeEvent,
  ApplicationContext,
  ApplicationSession,
  HostMethod,
} from '@t-box/app-contracts'
import type { AppTransport, RequestOptions } from '@t-box/app-sdk'
import { APP_SDK_VERSION } from '@t-box/app-contracts'
import {
  AppSdkError,
} from '@t-box/app-sdk'
import { watch } from 'vue'
import { applicationModules } from '../../applications/registry'
import { applicationMutation } from '../applicationMutation'
import { createRequestId } from '../identifiers'
import {
  backFromApplication,
  navigation,
  openApplication,
} from '../navigation'
import { chatWebSocketUrl, request } from '../network'
import { identity } from '../session'
import { appCatalog } from './catalog'
import { chooseApplicationFiles, decodeApplicationFile, readApplicationFile, uploadApplicationFile } from './files'
import { setApplicationBindings } from './resourceBindings'
import { parseApplicationHttpRequest, validateApplicationRestPath } from './trustedPath'

interface HostOptions {
  appId: string
  trusted?: boolean
  expected?: Pick<ApplicationContext, 'releaseId' | 'generation' | 'subject'>
  params?: Record<string, string>
}
const platform = () =>
  window.Capacitor?.isNativePlatform?.()
    ? window.Capacitor.getPlatform?.() || 'web'
    : 'web'
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppSdkError('INVALID_ARGUMENTS', '应用参数无效', 400)
  }
  return value as Record<string, unknown>
}
/** One app-bound host service shared by shell and MessageChannel adapters. */
export function createHostTransport(options: HostOptions): AppTransport {
  const module = applicationModules.find(
    (m) => m.manifest.id === options.appId,
  )
  if (options.trusted && !module) {
    throw new AppSdkError('APP_NOT_REGISTERED', '应用未注册')
  }
  let closed = false
  let epoch = 0
  let bound: ApplicationContext | undefined
  const lifetime = new AbortController()
  const listeners = new Set<(event: ApplicationBridgeEvent) => void>()
  const subscriptions = new Map<string, () => void>()
  const cancelledSubscriptions = new Set<string>()
  const emit = (event: ApplicationBridgeEvent) => {
    for (const listener of listeners) {
      listener(event)
    }
  }
  const session = (): ApplicationSession => ({
    status: !identity.ready
      ? 'restoring'
      : identity.user
        ? 'signed_in'
        : 'signed_out',
    subject: identity.user ? (bound?.subject ?? null) : null,
    ...(identity.user && bound?.permissions.includes('profile.read')
      ? { profile: { nickname: identity.user.nickname } }
      : {}),
  })
  const stopSubscriptions = () => {
    for (const stop of subscriptions.values()) {
      stop()
    }
    subscriptions.clear()
    cancelledSubscriptions.clear()
  }
  const close = (reason?: AppSdkError) => {
    if (closed) {
      return
    }
    if (reason) {
      emit({
        type: 'event',
        name: 'runtime.closed',
        data: {
          code: reason.code,
          message: reason.message,
          status: reason.status,
        },
      })
    }
    closed = true
    lifetime.abort()
    epoch++
    stopSubscriptions()
    // eslint-disable-next-line ts/no-use-before-define -- Watchers call close only after registration completes.
    stopIdentity()
    // eslint-disable-next-line ts/no-use-before-define -- Keep watcher registration and teardown order unchanged.
    stopCatalog()
    listeners.clear()
  }
  const stopIdentity = watch(
    () => [identity.token, identity.ready, identity.user?.id],
    () => {
      const started = ++epoch
      bound = undefined
      stopSubscriptions()
      emit({
        type: 'event',
        name: 'auth.changed',
        data: identity.user
          ? { status: 'restoring', subject: null }
          : session(),
      })
      if (!options.trusted) {
        close(
          new AppSdkError('SESSION_CHANGED', '登录状态已改变，请重新打开应用'),
        )
      } else if (identity.user) {
        void binding()
          .then(() => {
            if (!closed && started === epoch) {
              emit({ type: 'event', name: 'auth.changed', data: session() })
            }
          })
          .catch(() => {})
      }
    },
    { flush: 'post' },
  )
  const stopCatalog = watch(
    () => appCatalog.revision,
    () => {
      if (!bound || closed) {
        return
      }
      const installation = appCatalog.entries.find(
        (e) => e.release.appId === options.appId,
      )?.installation
      if (
        !installation ||
        installation.status !== 'active' ||
        installation.releaseId !== bound.releaseId ||
        installation.generation !== bound.generation
      ) {
        close(
          new AppSdkError(
            'APP_RUNTIME_EXPIRED',
            '应用安装状态已改变，请重新打开',
            409,
          ),
        )
      }
    },
    { flush: 'sync' },
  )
  function assertEpoch(expectedEpoch: number) {
    if (closed) {
      throw new AppSdkError('APP_CLOSED', '应用已关闭')
    }
    if (expectedEpoch !== epoch) {
      throw new AppSdkError('SESSION_CHANGED', '登录状态已改变，请重新操作')
    }
  }
  async function binding(signal?: AbortSignal): Promise<ApplicationContext> {
    const started = epoch
    assertEpoch(started)
    if (!identity.user) {
      throw new AppSdkError('AUTH_REQUIRED', '请先登录', 401)
    }
    const context = (
      await request<{ data: ApplicationContext }>(
        `/applications/${encodeURIComponent(options.appId)}/context?platform=${platform()}`,
        { signal },
      )
    ).data
    assertEpoch(started)
    const expected = options.expected ?? bound
    if (
      expected &&
      (context.releaseId !== expected.releaseId ||
        context.generation !== expected.generation ||
        context.subject !== expected.subject)
    ) {
      close(
        new AppSdkError(
          'APP_RUNTIME_EXPIRED',
          '应用版本或安装状态已改变，请重新打开',
          409,
        ),
      )
      throw new AppSdkError(
        'APP_RUNTIME_EXPIRED',
        '应用版本或安装状态已改变',
        409,
      )
    }
    if (
      context.sdkVersion !== APP_SDK_VERSION ||
      context.appId !== options.appId
    ) {
      throw new AppSdkError('PROTOCOL_MISMATCH', '应用 SDK 协议不兼容')
    }
    const storage = options.trusted && module?.sdk?.storage
    const events = Object.keys(module?.sdk?.events ?? {}).filter(
      (channel) =>
        options.trusted || context.permissions.includes(`events.${channel}`),
    )
    bound = {
      ...context,
      hostUrl: location.origin + location.pathname,
      params: { ...(options.params ?? {}) },
      capabilities: [
        ...new Set([
          ...context.capabilities,
          ...(storage
            ? [
                'storage.get' as const,
                'storage.set' as const,
                'storage.remove' as const,
              ]
            : []),
          ...(events.length || context.permissions.some((permission) => /^events\.[a-z][a-z0-9_.-]{0,63}$/.test(permission))
            ? ['events.subscribe' as const, 'events.unsubscribe' as const]
            : []),
        ]),
      ],
    }
    return bound
  }
  async function subscribe(
    context: ApplicationContext,
    args: Record<string, unknown>,
  ) {
    const id = args.subscriptionId
    if (
      typeof id !== 'string' ||
      !/^[\w-]{1,80}$/.test(id) ||
      subscriptions.has(id) ||
      subscriptions.size >= 32
    ) {
      throw new AppSdkError('INVALID_SUBSCRIPTION', '事件订阅无效或过多')
    }
    if (cancelledSubscriptions.delete(id)) {
      return { subscribed: false }
    }
    const channel = typeof args.channel === 'string' ? args.channel : ''
    const registered = module?.sdk?.events?.[channel]
    if (!registered && context.permissions.includes(`events.${channel}`) && /^[a-z][a-z0-9_.-]{0,63}$/.test(channel)) {
      const started = epoch
      let stopped = false
      let cursor: string | undefined
      let failures = 0
      let timer: ReturnType<typeof setTimeout> | undefined
      const abort = new AbortController()
      subscriptions.set(id, () => {
        stopped = true
        clearTimeout(timer)
        abort.abort()
      })
      const poll = async () => {
        try {
          assertEpoch(started)
          const result = (await request<{ data: { cursor: string, events: unknown[] } }>(`/applications/${encodeURIComponent(options.appId)}/events`, {
            method: 'POST',
            signal: abort.signal,
            body: JSON.stringify({ releaseId: context.releaseId, generation: context.generation, channel, cursor, arguments: args.arguments }),
          })).data
          assertEpoch(started)
          if (!stopped) {
            for (const value of result.events) {
              emit({ type: 'event', name: 'app.event', data: { subscriptionId: id, value } })
            }
            cursor = result.cursor
            failures = 0
          }
        } catch (error) {
          if (!stopped && !closed) {
            failures++
            const failure = AppSdkError.from(error)
            emit({ type: 'event', name: 'app.event.error', data: { subscriptionId: id, error: failure } })
            if ([401, 403, 409].includes(failure.status ?? 0)) {
              subscriptions.get(id)?.()
              subscriptions.delete(id)
            }
          }
        } finally {
          if (!stopped && !closed) {
            timer = setTimeout(() => {
              void poll()
            }, Math.min(60_000, 5000 * 2 ** Math.min(failures, 4)))
          }
        }
      }
      void poll()
      return { subscribed: true }
    }
    if (
      !registered ||
      (!options.trusted && !context.permissions.includes(`events.${channel}`))
    ) {
      throw new AppSdkError('PERMISSION_DENIED', '应用未授权此事件通道', 403)
    }
    const payload = registered.subscribe(args.arguments)
    const started = epoch
    let stopped = false
    let socket: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const fail = (error: unknown) =>
      emit({
        type: 'event',
        name: 'app.event.error',
        data: {
          subscriptionId: id,
          error: {
            code: AppSdkError.from(error).code,
            message: AppSdkError.from(error).message,
            status: AppSdkError.from(error).status,
          },
        },
      })
    const stop = () => {
      stopped = true
      clearTimeout(timer)
      socket?.close()
    }
    subscriptions.set(id, stop)
    const connect = async () => {
      if (stopped || closed) {
        return
      }
      try {
        assertEpoch(started)
        await binding()
        if (stopped || closed) {
          return
        }
        const token = identity.token
        socket = new WebSocket(chatWebSocketUrl(registered.path))
        const active = socket
        active.onopen = () => {
          if (stopped || started !== epoch || token !== identity.token) {
            active.close()
            return
          }
          active.send(JSON.stringify({ type: 'authenticate', token }))
        }
        active.onmessage = (event) => {
          if (stopped || closed || started !== epoch) {
            return
          }
          try {
            const value = JSON.parse(event.data)
            if (value.type === 'ready') {
              active.send(JSON.stringify(payload))
            } else if (value.type === 'error') {
              fail(
                new AppSdkError(
                  value.code || 'EVENT_FAILED',
                  '应用事件订阅失败',
                ),
              )
            } else {
              emit({
                type: 'event',
                name: 'app.event',
                data: { subscriptionId: id, value },
              })
            }
          } catch (error) {
            fail(error)
          }
        }
        active.onclose = (event) => {
          if (stopped || closed || started !== epoch) {
            return
          }
          if (event.code === 1008) {
            fail(
              new AppSdkError(
                'EVENT_AUTH_FAILED',
                '事件连接授权失效，请重新打开应用',
              ),
            )
            stop()
            subscriptions.delete(id)
          } else {
            timer = setTimeout(() => void connect(), 3000)
          }
        }
      } catch (error) {
        if (stopped || closed) {
          return
        }
        fail(error)
        const code = AppSdkError.from(error).code
        if (
          [
            'AUTH_REQUIRED',
            'APP_NOT_INSTALLED',
            'APP_RUNTIME_EXPIRED',
            'SESSION_CHANGED',
          ].includes(code)
        ) {
          stop()
          subscriptions.delete(id)
        } else {
          timer = setTimeout(() => void connect(), 3000)
        }
      }
    }
    void connect()
    return { subscribed: true }
  }
  return {
    listen(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close: () => close(),
    async call<T>(
      method: HostMethod,
      args: unknown,
      callOptions: RequestOptions = {},
    ): Promise<T> {
      const started = epoch
      assertEpoch(started)
      const timeoutMs = callOptions.timeoutMs ?? 15000
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
        throw new AppSdkError('INVALID_TIMEOUT', '请求超时时间无效')
      }
      if (method === 'auth.session' && !identity.user) {
        return session() as T
      }
      const context = await binding(callOptions.signal)
      if (!context.capabilities.includes(method)) {
        throw new AppSdkError(
          'CAPABILITY_UNAVAILABLE',
          '此应用没有该宿主能力',
          403,
        )
      }
      const a = object(args)
      let value: unknown
      if (method === 'runtime.context') {
        value = context
      } else if (method === 'auth.session') {
        value = session()
      } else if (method === 'resources.bindings') {
        setApplicationBindings(options.appId, a.bindings)
      } else if (method === 'files.pick' || method === 'files.upload') {
        const signal = callOptions.signal ? AbortSignal.any([lifetime.signal, callOptions.signal]) : lifetime.signal
        const files = method === 'files.pick' ? await chooseApplicationFiles(a, signal) : [decodeApplicationFile(a)]
        assertEpoch(started)
        const uploaded = []
        for (const file of files) {
          assertEpoch(started)
          signal.throwIfAborted()
          uploaded.push(await uploadApplicationFile(options.appId, file, signal))
        }
        value = method === 'files.pick' ? uploaded : uploaded[0]
      } else if (method === 'files.read') {
        if (Object.keys(a).some((key) => key !== 'id')) {
          throw new AppSdkError('INVALID_ARGUMENTS', '文件读取参数无效')
        }
        value = await readApplicationFile(options.appId, a.id, callOptions.signal)
      } else if (method === 'device.reminders') {
        if (Object.keys(a).some((k) => k !== 'action') || !module?.sdk?.reminders) {
          throw new AppSdkError('INVALID_ARGUMENTS', '提醒操作无效')
        }
        value = await module.sdk.reminders(a.action)
      } else if (method === 'api.request') {
        const http = parseApplicationHttpRequest(module?.sdk?.restPrefixes || [], a)
        if (http.stable === true) {
          value = await applicationMutation(http.path, http.method as 'POST' | 'PATCH' | 'DELETE', http.body)
        } else {
          value = await request(http.path, {
            method: http.method || 'GET',
            ...(http.body === undefined ? {} : { body: JSON.stringify(http.body) }),
            signal: callOptions.signal,
            timeoutMs,
            redirect: 'error',
            headers: { 'Idempotency-Key': callOptions.idempotencyKey || createRequestId() },
          })
        }
      } else if (method === 'api.invoke') {
        if (typeof a.method !== 'string') {
          throw new AppSdkError('INVALID_ARGUMENTS', '应用方法无效')
        }
        value = (
          await request<{ data: unknown }>(
            `/applications/${encodeURIComponent(options.appId)}/invoke`,
            {
              method: 'POST',
              signal: callOptions.signal,
              timeoutMs,
              headers: {
                'Idempotency-Key':
                  callOptions.idempotencyKey || createRequestId(),
              },
              body: JSON.stringify({
                releaseId: context.releaseId,
                generation: context.generation,
                method: a.method,
                arguments: a.arguments,
              }),
            },
          )
        ).data
      } else if (method.startsWith('storage.')) {
        if (typeof a.key !== 'string' || !/^[\w.-]{1,80}$/.test(a.key)) {
          throw new AppSdkError('INVALID_STORAGE_KEY', '应用存储键无效')
        }
        const key = `tbox.app.${options.appId}.${context.subject}.${a.key}`
        if (method === 'storage.get') {
          const saved = localStorage.getItem(key)
          const migrations = module?.sdk?.legacyStorageKeys
          const legacyKey = migrations && Object.hasOwn(migrations, a.key) ? migrations[a.key]?.(identity.user!.id) : undefined
          let serialized = saved
          if (serialized === null && legacyKey) {
            try {
              const old = localStorage.getItem(legacyKey)
              if (old !== null && old.length <= 64000) {
                JSON.parse(old)
                localStorage.setItem(key, old)
                serialized = old
              }
            } catch { /* Invalid legacy preferences do not prevent opening the application. */ }
          }
          value = JSON.parse(serialized || 'null')
        } else if (method === 'storage.remove') {
          localStorage.removeItem(key)
        } else {
          const serialized = JSON.stringify(a.value)
          if (serialized === undefined || serialized.length > 64000) {
            throw new AppSdkError(
              'INVALID_STORAGE_VALUE',
              '存储内容无效或过大',
            )
          }
          localStorage.setItem(key, serialized)
        }
      } else if (method === 'events.subscribe') {
        value = await subscribe(context, a)
      } else if (method === 'events.unsubscribe') {
        const id = String(a.subscriptionId)
        subscriptions.get(id)?.()
        subscriptions.delete(id)
        if (cancelledSubscriptions.size >= 128) {
          cancelledSubscriptions.delete(
            cancelledSubscriptions.values().next().value!,
          )
        }
        cancelledSubscriptions.add(id)
      } else if (method === 'navigation.open') {
        value = await openApplication({
          appId: options.appId,
          params: a.params,
        })
      } else if (method === 'navigation.back') {
        if (navigation.application?.appId !== options.appId) {
          throw new AppSdkError('NAVIGATION_DENIED', '只有当前应用可以返回')
        }
        // Acknowledge before the renderer unmounts and disposes its transport.
        setTimeout(() => {
          if (navigation.application?.appId === options.appId) {
            backFromApplication()
          }
        }, 0)
      }
      assertEpoch(started)
      return value as T
    },
  }
}

/** Explicit compatibility boundary for trusted first-party REST clients. */
export async function trustedApplicationRequest<T>(
  appId: string,
  path: string,
  options: RequestInit = {},
  mutation?: {
    method: 'POST' | 'PATCH' | 'DELETE'
    body: unknown
  },
): Promise<T> {
  const module = applicationModules.find((m) => m.manifest.id === appId)
  validateApplicationRestPath(module?.sdk?.restPrefixes ?? [], path)
  const token = identity.token
  const context = (
    await request<{ data: ApplicationContext }>(
      `/applications/${appId}/context?platform=${platform()}`,
      { signal: options.signal },
    )
  ).data
  if (identity.token !== token) {
    throw new AppSdkError('SESSION_CHANGED', '登录状态已改变')
  }
  if (context.runtime !== 'shell') {
    throw new AppSdkError('TRUSTED_RUNTIME_REQUIRED', '此接口仅供内置应用使用')
  }
  const result = mutation
    ? await applicationMutation<T>(path, mutation.method, mutation.body)
    : await request<T>(path, options)
  if (identity.token !== token) {
    throw new AppSdkError('SESSION_CHANGED', '登录状态已改变')
  }
  return result
}
