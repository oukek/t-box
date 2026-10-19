/** Stable device namespace per account/app. Guests never inherit a signed-in account's storage. */
const memory = new Map<string, string>()
export function deviceApplicationScope(appId: string, userId?: string, preferred?: string) {
  const key = `tbox.application-scope.v1.${encodeURIComponent(userId ?? '~guest')}.${appId}`
  try {
    const existing = localStorage.getItem(key)
    if (existing && /^[a-f0-9]{64}$/.test(existing)) {
      return existing
    }
  } catch { /* Memory-only mode still keeps the current session isolated. */ }
  const saved = memory.get(key)
  if (saved) {
    return saved
  }
  const value = preferred && /^[a-f0-9]{64}$/.test(preferred)
    ? preferred
    : Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  try {
    localStorage.setItem(key, value)
  } catch { /* Calculations do not depend on persistence. */ }
  memory.set(key, value)
  return value
}
