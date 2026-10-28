const storageKey = 'tbox.promotion.visit.v1'
const maxAge = 30 * 24 * 60 * 60_000
const valid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
let memory: { token: string, expiresAt: number } | undefined

export function promotionToken() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as typeof memory
    if (saved && valid(saved.token) && saved.expiresAt > Date.now() && saved.expiresAt <= Date.now() + maxAge) {
      memory = saved
    }
  } catch { /* The in-memory visit still survives until the server binds the login flow. */ }
  return memory && memory.expiresAt > Date.now() ? memory.token : undefined
}

export function capturePromotionLink() {
  const token = new URL(location.href).searchParams.get('ref')
  if (!valid(token) || promotionToken()) {
    return
  }
  memory = { token, expiresAt: Date.now() + maxAge }
  try {
    localStorage.setItem(storageKey, JSON.stringify(memory))
  } catch { /* Login flow binding persists the source before the OAuth redirect. */ }
}

export function clearPromotionVisit() {
  memory = undefined
  try {
    localStorage.removeItem(storageKey)
  } catch { /* Attribution has already been committed with registration. */ }
}
