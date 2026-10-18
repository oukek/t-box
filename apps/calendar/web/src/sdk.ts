import { SdkErrorCode } from '@t-box/app-sdk'
import { application } from './runtime'

export { application } from './runtime'

/** Only JSON and an optional idempotency key cross the host bridge. No account token. */
export function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (
    [...headers.keys()].some(
      (name) => name !== 'idempotency-key' && name !== 'content-type',
    ) ||
    (options.body !== undefined && typeof options.body !== 'string')
  ) {
    throw SdkErrorCode.INVALID_ARGUMENTS()
  }
  return application.client.api.request<T>(
    path,
    {
      method: (options.method || 'GET') as
        'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
      ...(options.body === undefined
        ? {}
        : { body: JSON.parse(options.body as string) }),
    },
    {
      signal: options.signal || undefined,
      timeoutMs: 120_000,
      idempotencyKey: headers.get('Idempotency-Key') || undefined,
    },
  )
}
export function applicationMutation<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
): Promise<T> {
  return application.client.api.mutate<T>(path, method, body)
}
