import type {
  ApplicationBridgeEvent,
  ApplicationContext,
  ApplicationSession,
  HostMethod,
} from '@t-box/app-contracts'
import type { AppTransport, RequestOptions } from '@t-box/app-sdk'
import { APP_SDK_VERSION } from '@t-box/app-contracts'
import { AppSdkError, SdkErrorCode } from '@t-box/app-sdk'
import { watch } from 'vue'
import { applicationModules } from '../../applications/registry'
import { applicationMutation } from '../applicationMutation'
import { createRequestId } from '../identifiers'
import { applicationActions, saveApplicationShortcut } from '../native-runtime/actions'
import { promptNativeDownload } from '../native-runtime/downloads'
import { deviceHostMethods, handleDeviceCall } from '../native-runtime/host'
import {
  backFromApplication,
  isApplicationActive,
  openApplication,
} from '../navigation'
import { chatWebSocketUrl, request } from '../network'
import { identity } from '../session'
import { appCatalog } from './catalog'
import { deviceApplicationScope } from './deviceStorage'
import {
  chooseApplicationFiles,
  decodeApplicationFile,
  privateFileScope,
  readApplicationFile,
  readPrivateApplicationFile,
  uploadApplicationFile,
  uploadPrivateApplicationFile,
} from './files'
import { localBaselineContext } from './localApplications'
import { isLocalMethod, resolveLocalLaunch } from './localLaunch'
import { setApplicationBindings } from './resourceBindings'
import {
  parseApplicationHttpRequest,
  validateApplicationRestPath,
} from './trustedPath'
import { availableUpdate, updatePrompts } from './updatePrompts'

interface HostOptions {
  appId: string
  trusted?: boolean
  expected?: Pick<
    ApplicationContext,
    'releaseId' | 'generation' | 'subject'
  > & { localOnly?: boolean }
  params?: Record<string, string>
}
const platform = () =>
  window.Capacitor?.isNativePlatform?.()
    ? window.Capacitor.getPlatform?.() || 'web'
    : 'web'
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw SdkErrorCode.INVALID_ARGUMENTS('应用参数无效', 400)
  }
  return value as Record<string, unknown>
}
/** One app-bound host service shared by shell and MessageChannel adapters. */
export function createHostTransport(options: HostOptions): AppTransport {
  const module = applicationModules.find(
    (m) => m.manifest.id === options.appId,
  )
  if (options.trusted && !module) {
    throw SdkErrorCode.APP_NOT_REGISTERED()
  }
  let closed = false
  let epoch = 0
  let bound: ApplicationContext | undefined
  const lifetime = new AbortController()
  const updateOwner = {}
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
    updatePrompts.unregister(options.appId, updateOwner)
    // eslint-disable-next-line ts/no-use-before-define -- Watchers call close only after registration completes.
    stopIdentity()
    // eslint-disable-next-line ts/no-use-before-define -- Keep watcher registration and teardown order unchanged.
    stopCatalog()
    listeners.clear()
  }
  const stopIdentity = watch(
    [() => identity.token, () => identity.ready, () => identity.user?.id],
    () => {
      const started = ++epoch
      bound = undefined
      updatePrompts.unregister(options.appId, updateOwner)
      stopSubscriptions()
      emit({
        type: 'event',
        name: 'auth.changed',
        data: identity.user
          ? { status: 'restoring', subject: null }
          : session(),
      })
      if (!options.trusted) {
        close(SdkErrorCode.SESSION_CHANGED('登录状态已改变，请重新打开应用'))
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
      if (options.expected?.localOnly) {
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
        close(SdkErrorCode.APP_RUNTIME_EXPIRED(undefined, 409))
      }
    },
    { flush: 'sync' },
  )
  function assertEpoch(expectedEpoch: number) {
    if (closed) {
      throw SdkErrorCode.APP_CLOSED()
    }
    if (expectedEpoch !== epoch) {
      throw SdkErrorCode.SESSION_CHANGED()
    }
  }
  async function binding(
    signal?: AbortSignal,
    local = false,
  ): Promise<ApplicationContext> {
    const started = epoch
    assertEpoch(started)
    const currentPlatform = platform()
    const targetPlatform =
      currentPlatform === 'ios' || currentPlatform === 'android'
        ? currentPlatform
        : 'web'
    const cached = local
      ? options.expected?.localOnly
        ? localBaselineContext(options.appId, options.expected, targetPlatform)
        : resolveLocalLaunch(appCatalog.entries, options.appId, targetPlatform)
          ?.context
      : undefined
    if (!identity.user && !(cached && options.expected?.localOnly)) {
      throw SdkErrorCode.AUTH_REQUIRED('此功能需要登录并联网后使用', 401)
    }
    if (!local && options.expected?.localOnly) {
      throw SdkErrorCode.APP_UPDATE_REQUIRED(undefined, 409)
    }
    const context =
      cached ??
      (
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
        SdkErrorCode.APP_RUNTIME_EXPIRED(
          '应用版本或安装状态已改变，请重新打开',
          409,
        ),
      )
      throw SdkErrorCode.APP_RUNTIME_EXPIRED('应用版本或安装状态已改变', 409)
    }
    if (
      context.sdkVersion !== APP_SDK_VERSION ||
      context.appId !== options.appId
    ) {
      throw SdkErrorCode.PROTOCOL_MISMATCH()
    }
    const storage =
      options.trusted && module?.sdk?.storage && context.access !== 'local'
    const events = Object.keys(
      context.access === 'local' ? {} : (module?.sdk?.events ?? {}),
    ).filter(
      (channel) =>
        options.trusted || context.permissions.includes(`events.${channel}`),
    )
    bound = {
      ...context,
      access: context.access ?? 'online',
      hostUrl: location.origin + location.pathname,
      supportsAppNavigation: true,
      params: { ...(options.params ?? {}) },
      capabilities: [
        ...new Set([
          ...context.capabilities,
          ...deviceHostMethods,
          'automation.actions' as const,
          ...(platform() === 'ios' ? ['automation.saveShortcut' as const] : []),
          ...(storage
            ? [
                'storage.get' as const,
                'storage.set' as const,
                'storage.remove' as const,
              ]
            : []),
          ...(events.length ||
            context.permissions.some((permission) =>
              /^events\.[a-z][a-z0-9_.-]{0,63}$/.test(permission),
            )
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
      throw SdkErrorCode.INVALID_SUBSCRIPTION()
    }
    if (cancelledSubscriptions.delete(id)) {
      return { subscribed: false }
    }
    const channel = typeof args.channel === 'string' ? args.channel : ''
    const registered = module?.sdk?.events?.[channel]
    if (
      !registered &&
      context.permissions.includes(`events.${channel}`) &&
      /^[a-z][a-z0-9_.-]{0,63}$/.test(channel)
    ) {
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
          const result = (
            await request<{ data: { cursor: string, events: unknown[] } }>(
              `/applications/${encodeURIComponent(options.appId)}/events`,
              {
                method: 'POST',
                signal: abort.signal,
                body: JSON.stringify({
                  releaseId: context.releaseId,
                  generation: context.generation,
                  channel,
                  cursor,
                  arguments: args.arguments,
                }),
              },
            )
          ).data
          assertEpoch(started)
          if (!stopped) {
            for (const value of result.events) {
              emit({
                type: 'event',
                name: 'app.event',
                data: { subscriptionId: id, value },
              })
            }
            cursor = result.cursor
            failures = 0
          }
        } catch (error) {
          if (!stopped && !closed) {
            failures++
            const failure = AppSdkError.from(error)
            emit({
              type: 'event',
              name: 'app.event.error',
              data: { subscriptionId: id, error: failure },
            })
            if ([401, 403, 409].includes(failure.status ?? 0)) {
              subscriptions.get(id)?.()
              subscriptions.delete(id)
            }
          }
        } finally {
          if (!stopped && !closed) {
            timer = setTimeout(
              () => {
                void poll()
              },
              Math.min(60_000, 5000 * 2 ** Math.min(failures, 4)),
            )
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
      throw SdkErrorCode.PERMISSION_DENIED(undefined, 403)
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
                AppSdkError.from(
                  { code: value.code, message: '应用事件订阅失败' },
                  SdkErrorCode.EVENT_FAILED(),
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
            fail(SdkErrorCode.EVENT_AUTH_FAILED())
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
        throw SdkErrorCode.INVALID_TIMEOUT()
      }
      if (method === 'auth.session' && !identity.user) {
        return session() as T
      }
      if (method === 'automation.saveShortcut' && promptNativeDownload('快捷指令', 'ios')) {
        throw SdkErrorCode.DEVICE_UNSUPPORTED('快捷指令需下载 iOS App 后使用')
      }
      if (method === 'device.reminders' && module?.sdk?.reminders) {
        const action = object(args)
        if (Object.keys(action).some((key) => key !== 'action')) {
          throw SdkErrorCode.INVALID_ARGUMENTS('提醒操作无效')
        }
        if (['enable', 'exact'].includes(String(action.action)) && promptNativeDownload(action.action === 'exact' ? '系统精确提醒' : '后台系统通知')) {
          throw SdkErrorCode.DEVICE_UNSUPPORTED('后台系统通知需下载 App 后使用，网页前台提醒仍可使用')
        }
      }
      if (!isLocalMethod(method) && !identity.user) {
        throw SdkErrorCode.AUTH_REQUIRED('此功能需要登录并联网后使用', 401)
      }
      if (!isLocalMethod(method) && !navigator.onLine) {
        throw SdkErrorCode.NETWORK_REQUIRED()
      }
      const context = await binding(callOptions.signal, isLocalMethod(method) || method.startsWith('automation.'))
      assertEpoch(started)
      if (!context.capabilities.includes(method)) {
        throw SdkErrorCode.CAPABILITY_UNAVAILABLE(undefined, 403)
      }
      const a = object(args)
      let value: unknown
      if (deviceHostMethods.includes(method)) {
        value = await handleDeviceCall({ method, args, context, owner: identity.user?.id, name: module?.manifest.name || options.appId, bundled: module?.sdk?.deviceCapabilities, requestId: callOptions.idempotencyKey || createRequestId(), signal: AbortSignal.any([lifetime.signal, ...(callOptions.signal ? [callOptions.signal] : [])]), assertCurrent: () => assertEpoch(started) })
      } else if (method === 'automation.actions') {
        if (Object.keys(a).length) {
          throw SdkErrorCode.INVALID_ARGUMENTS()
        }
        value = await applicationActions(options.appId)
      } else if (method === 'automation.saveShortcut') {
        value = await saveApplicationShortcut(context, args, AbortSignal.any([lifetime.signal, ...(callOptions.signal ? [callOptions.signal] : [])]), () => assertEpoch(started))
      } else if (method === 'runtime.context') {
        value = context
      } else if (method === 'updates.getAvailable') {
        value = availableUpdate(
          appCatalog.entries.find(
            (entry) => entry.release.appId === options.appId,
          ),
        )
      } else if (method === 'updates.openMarket') {
        if (
          !isApplicationActive(options.appId)
        ) {
          throw SdkErrorCode.NAVIGATION_DENIED()
        }
        // Cross-origin frames need a delivery turn before navigation tears down their MessageChannel.
        setTimeout(() => {
          if (!closed && isApplicationActive(options.appId)) {
            void openApplication({
              appId: 'market',
              params: { appId: options.appId },
            }).catch(() => {})
          }
        }, 50)
      } else if (method === 'updates.presentation') {
        if (
          typeof a.registrationId !== 'string' ||
          !/^[\w-]{1,80}$/.test(a.registrationId) ||
          typeof a.enabled !== 'boolean'
        ) {
          throw SdkErrorCode.INVALID_ARGUMENTS('更新提示注册无效')
        }
        if (a.enabled) {
          if (context.updatePrompt?.mode !== 'custom') {
            throw SdkErrorCode.CUSTOM_UPDATE_PROMPT_DISABLED()
          }
          updatePrompts.register(
            options.appId,
            updateOwner,
            a.registrationId,
            (data) => emit({ type: 'event', name: 'runtime.update', data }),
          )
        } else {
          updatePrompts.unregister(
            options.appId,
            updateOwner,
            a.registrationId,
          )
        }
      } else if (method === 'updates.respond') {
        if (typeof a.promptId !== 'string' || typeof a.shown !== 'boolean') {
          throw SdkErrorCode.INVALID_ARGUMENTS('更新提示确认无效')
        }
        value = updatePrompts.respond(
          options.appId,
          updateOwner,
          a.promptId,
          a.shown,
        )
      } else if (method === 'auth.session') {
        value = session()
      } else if (method === 'resources.bindings') {
        setApplicationBindings(options.appId, a.bindings)
      } else if (
        method === 'files.private.pick' ||
        method === 'files.private.upload'
      ) {
        if (
          Object.keys(a).some(
            (key) =>
              ![
                'scope',
                method === 'files.private.pick' ? 'options' : 'file',
              ].includes(key),
          )
        ) {
          throw SdkErrorCode.INVALID_ARGUMENTS()
        }
        if (
          method === 'files.private.upload' &&
          (!a.file || typeof a.file !== 'object' || Array.isArray(a.file))
        ) {
          throw SdkErrorCode.INVALID_ARGUMENTS()
        }
        const scope = privateFileScope(a.scope)
        const signal = callOptions.signal
          ? AbortSignal.any([lifetime.signal, callOptions.signal])
          : lifetime.signal
        const files =
          method === 'files.private.pick'
            ? await chooseApplicationFiles(
                (a.options || {}) as { accept?: string, multiple?: boolean },
                signal,
              )
            : [decodeApplicationFile(a.file as Record<string, unknown>)]
        assertEpoch(started)
        const uploaded = []
        for (const file of files) {
          assertEpoch(started)
          signal.throwIfAborted()
          uploaded.push(
            await uploadPrivateApplicationFile(
              options.appId,
              scope,
              file,
              signal,
            ),
          )
        }
        value = method === 'files.private.pick' ? uploaded : uploaded[0]
      } else if (method === 'files.private.read') {
        if (Object.keys(a).some((key) => !['id', 'original'].includes(key))) {
          throw SdkErrorCode.INVALID_ARGUMENTS()
        }
        value = await readPrivateApplicationFile(
          options.appId,
          a.id,
          a.original,
          callOptions.signal,
        )
      } else if (method === 'files.pick' || method === 'files.upload') {
        const signal = callOptions.signal
          ? AbortSignal.any([lifetime.signal, callOptions.signal])
          : lifetime.signal
        const files =
          method === 'files.pick'
            ? await chooseApplicationFiles(a, signal)
            : [decodeApplicationFile(a)]
        assertEpoch(started)
        const uploaded = []
        for (const file of files) {
          assertEpoch(started)
          signal.throwIfAborted()
          uploaded.push(
            await uploadApplicationFile(options.appId, file, signal),
          )
        }
        value = method === 'files.pick' ? uploaded : uploaded[0]
      } else if (method === 'files.read') {
        if (Object.keys(a).some((key) => key !== 'id')) {
          throw SdkErrorCode.INVALID_ARGUMENTS('文件读取参数无效')
        }
        value = await readApplicationFile(
          options.appId,
          a.id,
          callOptions.signal,
        )
      } else if (method === 'device.reminders') {
        if (
          Object.keys(a).some((k) => k !== 'action') ||
          !module?.sdk?.reminders
        ) {
          throw SdkErrorCode.INVALID_ARGUMENTS('提醒操作无效')
        }
        value = await module.sdk.reminders(a.action)
      } else if (method === 'api.request') {
        const http = parseApplicationHttpRequest(
          module?.sdk?.restPrefixes || [],
          a,
        )
        if (http.stable === true) {
          value = await applicationMutation(
            http.path,
            http.method as 'POST' | 'PATCH' | 'DELETE',
            http.body,
          )
        } else {
          value = await request(http.path, {
            method: http.method || 'GET',
            ...(http.body === undefined
              ? {}
              : { body: JSON.stringify(http.body) }),
            signal: callOptions.signal,
            timeoutMs,
            redirect: 'error',
            headers: {
              'Idempotency-Key':
                callOptions.idempotencyKey || createRequestId(),
            },
          })
        }
      } else if (method === 'api.invoke') {
        if (typeof a.method !== 'string') {
          throw SdkErrorCode.INVALID_ARGUMENTS('应用方法无效')
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
          throw SdkErrorCode.INVALID_STORAGE_KEY()
        }
        const scope = deviceApplicationScope(
          options.appId,
          identity.user?.id,
          context.subject,
        )
        const key = `tbox.app.${options.appId}.${scope}.${a.key}`
        if (method === 'storage.get') {
          const saved = localStorage.getItem(key)
          const migrations = module?.sdk?.legacyStorageKeys
          const legacyKey =
            identity.user && migrations && Object.hasOwn(migrations, a.key)
              ? migrations[a.key]?.(identity.user.id)
              : undefined
          let serialized = saved
          if (serialized === null && legacyKey) {
            try {
              const old = localStorage.getItem(legacyKey)
              if (old !== null && old.length <= 64000) {
                JSON.parse(old)
                localStorage.setItem(key, old)
                serialized = old
              }
            } catch {
              /* Invalid legacy preferences do not prevent opening the application. */
            }
          }
          value = JSON.parse(serialized || 'null')
        } else if (method === 'storage.remove') {
          localStorage.removeItem(key)
        } else {
          const serialized = JSON.stringify(a.value)
          if (serialized === undefined || serialized.length > 64000) {
            throw SdkErrorCode.INVALID_STORAGE_VALUE()
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
        const params = object(a.params)
        // Existing local calendar/time bundles use this exact profile link for login.
        // Handle the login intent without granting general cross-application navigation.
        const requestsLogin = !identity.user && ['calendar', 'time'].includes(options.appId) && Object.keys(params).length === 1 && params.appId === 'profile'
        if (requestsLogin) {
          if (!isApplicationActive(options.appId)) {
            throw SdkErrorCode.NAVIGATION_DENIED('只有当前应用可以打开登录窗口')
          }
          value = await openApplication({ appId: 'profile' })
        } else {
          value = await openApplication({ appId: options.appId, params })
        }
      } else if (method === 'navigation.back') {
        if (!isApplicationActive(options.appId)) {
          throw SdkErrorCode.NAVIGATION_DENIED('只有当前应用可以返回')
        }
        // Allow the reply to reach the cross-origin frame before disposing its pending back request.
        setTimeout(() => {
          if (isApplicationActive(options.appId)) {
            backFromApplication()
          }
        }, 50)
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
    throw SdkErrorCode.SESSION_CHANGED('登录状态已改变')
  }
  if (context.runtime !== 'shell') {
    throw SdkErrorCode.TRUSTED_RUNTIME_REQUIRED()
  }
  const result = mutation
    ? await applicationMutation<T>(path, mutation.method, mutation.body)
    : await request<T>(path, options)
  if (identity.token !== token) {
    throw SdkErrorCode.SESSION_CHANGED('登录状态已改变')
  }
  return result
}
