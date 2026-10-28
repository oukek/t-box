export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }

  static fromResponse(status: number, value?: { message?: string }) {
    return new RequestError(value?.message ?? '请求失败', status)
  }
}
export const apiBase = (
  import.meta.env.VITE_API_BASE_URL?.trim() || '/api/v1'
).replace(/\/+$/, '')
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBase}/admin${path}`, {
    ...options,
    credentials: 'include',
    signal: options.signal ?? AbortSignal.timeout(30_000),
    headers: {
      ...(options.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
      'X-Admin-Request': '1',
      ...options.headers,
    },
  })
  if (response.status === 204) {
    return undefined as T
  }
  const body = await response
    .json()
    .catch(() => ({ error: { message: '服务返回了无法读取的数据' } }))
  if (!response.ok) {
    if (response.status === 401 && path !== '/session') {
      window.dispatchEvent(new Event('admin-session-expired'))
    }
    throw RequestError.fromResponse(response.status, body.error)
  }
  return body.data as T
}
export const save = <T>(path: string, data: unknown, method = 'POST') =>
  request<T>(path, { method, body: JSON.stringify(data) })
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.name === 'TimeoutError'
      ? '请求超时，请检查操作结果后重试。'
      : error.message
    : '操作失败'

export async function requestBlob(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBase}/admin${path}`, {
    ...options,
    credentials: 'include',
    signal: options.signal ?? AbortSignal.timeout(30_000),
    headers: { 'X-Admin-Request': '1', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event('admin-session-expired'))
    }
    const value = await response.json().catch(() => ({}))
    throw RequestError.fromResponse(response.status, value.error)
  }
  return response.blob()
}
