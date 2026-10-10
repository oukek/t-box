import { createRequestId } from './identifiers'
import { request, RequestError } from './network'
import { identity } from './session'

const pending = new Map<string, string>()
/** An unknown network outcome retains its key across identical retries and reloads. */
export async function applicationMutation<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
): Promise<T> {
  const serialized = JSON.stringify(body)
  const signature = JSON.stringify([identity.user?.id, path, method, serialized])
  // A lossless storage key also works on LAN HTTP live reload where SubtleCrypto is unavailable.
  const storageKey = `tbox.pending-operation:${signature}`
  let key = pending.get(storageKey) || createRequestId()
  try {
    key = sessionStorage.getItem(storageKey) || key
    sessionStorage.setItem(storageKey, key)
  } catch {}
  pending.set(storageKey, key)
  const clear = () => {
    pending.delete(storageKey)
    try {
      sessionStorage.removeItem(storageKey)
    } catch {}
  }
  try {
    const result = await request<T>(path, {
      method,
      body: serialized,
      headers: { 'Idempotency-Key': key },
    })
    clear()
    return result
  } catch (error) {
    if (error instanceof RequestError && error.status < 500) {
      clear()
    }
    throw error
  }
}
