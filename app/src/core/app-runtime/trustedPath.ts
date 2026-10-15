import { AppSdkError } from '@t-box/app-sdk'

export function parseApplicationHttpRequest(prefixes: readonly string[], value: unknown) {
  const a = value as { path: string, method?: string, body?: unknown, stable?: boolean }
  if (!a || typeof a !== 'object' || Array.isArray(a) ||
    Object.keys(a).some((k) => !['path', 'method', 'body', 'stable'].includes(k)) ||
    typeof a.path !== 'string' ||
    (a.method !== undefined && typeof a.method !== 'string') ||
    !['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(a.method || 'GET') ||
    (a.stable !== undefined && typeof a.stable !== 'boolean') ||
    ((a.method || 'GET') === 'GET' && a.body !== undefined) ||
    (a.stable && !['POST', 'PATCH', 'DELETE'].includes(a.method || 'GET'))) {
    throw new AppSdkError('INVALID_ARGUMENTS', '应用接口参数无效')
  }
  validateApplicationRestPath(prefixes, a.path)
  return a
}
/** Validate before the network layer attaches host credentials. Query values are not path segments. */
export function validateApplicationRestPath(
  prefixes: readonly string[],
  path: string,
) {
  if (
    !prefixes.some(
      (prefix) =>
        path === prefix ||
        path.startsWith(`${prefix}/`) ||
        path.startsWith(`${prefix}?`),
    )
  ) {
    throw new AppSdkError('API_SCOPE_DENIED', '应用未注册此接口范围', 403)
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(path.split('?')[0]!)
  } catch {
    throw new AppSdkError('INVALID_API_PATH', '应用接口路径无效')
  }
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    // eslint-disable-next-line no-control-regex -- Reject control characters and spaces in untrusted application paths.
    /[\\#\u0000-\u0020]/.test(path) ||
    decoded.split('/').some((part) => part === '.' || part === '..') ||
    // eslint-disable-next-line no-control-regex -- Apply the same validation after percent decoding.
    /[\\\u0000-\u0020]/.test(decoded) ||
    decoded.includes('//') ||
    /%[a-f\d]{2}/i.test(decoded)
  ) {
    throw new AppSdkError('INVALID_API_PATH', '应用接口路径无效')
  }
}
