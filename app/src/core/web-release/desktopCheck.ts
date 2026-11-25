/** One task serves startup, foreground, network and manual requests in the desktop host. */
export function desktopChecks(run: (manual: () => boolean) => Promise<boolean>, available: () => boolean, now = Date.now) {
  const interval = 30 * 60000
  let next = 0
  let retry = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> | undefined
  let manualRequested = false
  let disposed = false

  function schedule() {
    clearTimeout(timer)
    if (!disposed && available()) {
      timer = setTimeout(() => {
        void check('timer')
      }, Math.max(0, next - now()))
    }
  }
  function check(trigger: 'startup' | 'foreground' | 'online' | 'manual' | 'timer') {
    if (disposed) {
      return
    }
    if (pending) {
      if (trigger === 'manual') {
        manualRequested = true
      }
      return pending
    }
    if (!available()) {
      return
    }
    const manual = trigger === 'manual'
    // Foreground checks are useful after a minute away. Network failures retain their backoff.
    const eligible = trigger === 'foreground' && !retry ? next - interval + 60000 : next
    if (!manual && trigger !== 'online' && now() < eligible) {
      schedule()
      return
    }
    if (trigger === 'online' && retry && now() < next) {
      schedule()
      return
    }
    clearTimeout(timer)
    manualRequested = manual
    pending = Promise.resolve().then(() => run(() => manualRequested)).catch(() => false).then((ok) => {
      retry = ok ? 0 : Math.min(interval, retry ? retry * 2 : 60000)
      next = now() + (retry || interval)
    }).finally(() => {
      pending = undefined
      schedule()
    })
    return pending
  }
  return {
    check,
    resume: schedule,
    defer() {
      next = now() + interval
      retry = 0
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
    },
  }
}
