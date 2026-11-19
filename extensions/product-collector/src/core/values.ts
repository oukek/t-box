export type Obj = Record<string, unknown>
export function object(value: unknown): Obj {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Obj)
    : {}
}
export function text(value: unknown): string {
  return typeof value === 'string'
    ? value.trim()
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : ''
}
export function decimal(value: unknown): string | null {
  const raw = text(value).replace(/,/g, '')
  return /^\d+(?:\.\d+)?$/.test(raw) ? raw : null
}
export function count(value: unknown): number | null {
  const n = decimal(value)
  return n !== null && Number.isSafeInteger(Number(n)) ? Number(n) : null
}
// Export only bounded product-scoped JSON. Account/session fields are never retained.
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 10) {
    return null
  }
  if (typeof value === 'string') {
    return value.slice(0, 60000)
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((v) => sanitize(v, depth + 1))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            !/cookie|token|password|secret|authorization|session|userInfo|account|phone|email|address|__proto__|constructor|prototype/i.test(
              k,
            ),
        )
        .slice(0, 150)
        .map(([k, v]) => [k, sanitize(v, depth + 1)]),
    )
  }
  return null
}
