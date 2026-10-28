import type { DataSource } from 'typeorm'

const sources = new WeakMap<DataSource, Map<string, Set<() => void>>>()
export function watchQr(source: DataSource, key: string, listener: () => void) {
  let signals = sources.get(source)
  if (!signals) {
    signals = new Map()
    sources.set(source, signals)
  }
  const listeners = signals.get(key) ?? new Set()
  signals.set(key, listeners)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      signals.delete(key)
    }
  }
}
export function qrChanged(source: DataSource, key: string) {
  for (const listener of sources.get(source)?.get(key) ?? []) {
    try {
      listener()
    } catch { /* Delivery cannot undo a committed change. */ }
  }
}
