import { AppSdkError } from '@t-box/app-sdk'
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
