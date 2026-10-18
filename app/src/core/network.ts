import { RequestError } from '@t-box/app-shell-sdk'
import { ErrorCode } from '../error-codes.js'
import { createRequestId } from './identifiers'
import { identity, setSession } from './session'

export { RequestError } from '@t-box/app-shell-sdk'
const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim()
export const apiBase = (configuredBase || '/api/v1').replace(/\/+$/, '')

export const configurationError =
  !import.meta.env.DEV &&
  window.Capacitor?.isNativePlatform?.() &&
  !configuredBase
    ? '应用尚未配置服务地址。请设置 VITE_API_BASE_URL 后重新打包应用。'
    : ''

export async function request<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  if (configurationError) {
    throw ErrorCode.INTERNAL_CLIENT_CONFIGURATION_REQUIRED(configurationError)
  }
  const { timeoutMs = 15000, ...fetchOptions } = options
  const controller = new AbortController()
  const abort = () => controller.abort()
  const externalSignal = options.signal
  if (externalSignal?.aborted) {
    abort()
  } else {
    externalSignal?.addEventListener('abort', abort, { once: true })
  }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        ...(identity.token
          ? { Authorization: `Bearer ${identity.token}` }
          : {}),
        ...(['POST', 'PATCH', 'DELETE'].includes(options.method ?? '')
          ? { 'Idempotency-Key': createRequestId() }
          : {}),
        ...(options.body && !(options.body instanceof Blob)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options.headers,
      },
    })
    if (response.status === 204) {
      return undefined as T
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      if (controller.signal.aborted) {
        throw error
      }
      throw ErrorCode.INTERNAL_INVALID_SERVER_RESPONSE()
    }
    if (!response.ok) {
      const errorBody = body as {
        error?: {
          message?: string
          code?: string
          details?: Record<string, string>
        }
      }
      if (response.status === 401 && path !== '/auth/login') {
        setSession(null)
      }
      throw RequestError.fromResponse(response.status, errorBody.error)
    }
    return body as T
  } catch (error) {
    if (timedOut) {
      throw ErrorCode.INTERNAL_REQUEST_TIMED_OUT()
    }
    if (controller.signal.aborted) {
      throw error
    }
    if (error instanceof TypeError) {
      throw ErrorCode.INTERNAL_SERVER_UNREACHABLE()
    }
    throw error
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', abort)
  }
}

export function chatWebSocketUrl(path = '/chat/ws'): string {
  if (configurationError) {
    throw ErrorCode.INTERNAL_CLIENT_CONFIGURATION_REQUIRED(configurationError)
  }
  const url = new URL(`${apiBase}${path}`, window.location.href)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw ErrorCode.INTERNAL_HTTP_HTTPS()
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}
