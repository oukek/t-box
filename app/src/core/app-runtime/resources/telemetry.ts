import { request } from '../../network'
import { identity } from '../../session'

export interface LaunchMeasurement {
  id: string
  appId: string
  releaseId: string
  source: 'local' | 'network' | 'development'
  platform: string
  outcome: 'ready' | 'failed' | 'cancelled' | 'rolled_back'
  totalMs: number
  stages: Record<string, number>
  errorCode?: string
  createdAt: string
}
const storageKey = 'tbox.application-launches.v1'
/** Stage boundaries measure real work; the launch animation has no influence on readiness. */
export function measureLaunch(appId: string) {
  const start = performance.now()
  const report: LaunchMeasurement = { id: crypto.randomUUID(), appId, releaseId: '', source: 'network', platform: window.Capacitor?.getPlatform?.() || 'web', outcome: 'cancelled', totalMs: 0, stages: {}, createdAt: new Date().toISOString() }
  let previous = start
  let stage = 'resolving'
  let ended = false
  const mark = (next: string) => {
    if (ended) {
      return
    }
    const now = performance.now()
    report.stages[stage] = Math.round((report.stages[stage] || 0) + now - previous)
    previous = now
    stage = next
  }
  return {
    report,
    mark,
    finish(outcome: LaunchMeasurement['outcome'], error?: unknown) {
      if (ended) {
        return
      }
      mark('finished')
      ended = true
      report.totalMs = Math.round(performance.now() - start)
      report.outcome = outcome
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
        report.errorCode = error.code.slice(0, 100)
      }
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || '[]') as unknown
        localStorage.setItem(storageKey, JSON.stringify([...(Array.isArray(saved) ? saved : []), report].slice(-100)))
      } catch { /* Diagnostics never prevent opening an application. */ }
      // Structured server logs are retained by PM2/container logging. Never transmit URLs, prompts or SDK data.
      if (identity.user && navigator.onLine) {
        void request(`/applications/${encodeURIComponent(appId)}/launches`, { method: 'POST', body: JSON.stringify(report), timeoutMs: 5000 }).catch(() => {})
      }
      window.dispatchEvent(new CustomEvent('tbox:application-launch', { detail: report }))
    },
  }
}
