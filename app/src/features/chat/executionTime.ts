import type { MessageExecution } from '@t-box/shared'

export function elapsedExecution(
  execution: Readonly<MessageExecution>,
  active: boolean,
  now = Date.now(),
) {
  const since = execution.activeSince ? Date.parse(execution.activeSince) : NaN
  return (
    Math.max(0, execution.durationMs) +
    (active && Number.isFinite(since) ? Math.max(0, now - since) : 0)
  )
}
export function formatExecutionTime(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分钟 ${seconds % 60} 秒`
}
