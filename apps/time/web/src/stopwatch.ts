export interface StopwatchState {
  elapsed: number
  startedAt: number | null
  laps: number[]
}
export function stopwatchElapsed(state: StopwatchState, now: number) {
  return (
    state.elapsed +
    (state.startedAt === null ? 0 : Math.max(0, now - state.startedAt))
  )
}
export function parseStopwatch(value: unknown): StopwatchState {
  const v = value as Partial<StopwatchState> | null
  if (
    !v ||
    !Number.isFinite(v.elapsed) ||
    v.elapsed! < 0 ||
    !(
      v.startedAt === null ||
      (Number.isFinite(v.startedAt) && v.startedAt! > 0)
    ) ||
    !Array.isArray(v.laps) ||
    v.laps.length > 200 ||
    v.laps.some(
      (n, i, a) => !Number.isFinite(n) || n < 0 || (i > 0 && n < a[i - 1]!),
    )
  ) {
    return { elapsed: 0, startedAt: null, laps: [] }
  }
  return { elapsed: v.elapsed!, startedAt: v.startedAt!, laps: v.laps }
}
export function durationLabel(ms: number, centiseconds = false) {
  const n = Math.floor(Math.max(0, ms) / (centiseconds ? 10 : 1000))
  const seconds = centiseconds ? Math.floor(n / 100) : n
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}${centiseconds ? `.${String(n % 100).padStart(2, '0')}` : ''}`
}
