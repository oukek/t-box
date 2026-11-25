function waitFor(worker: ServiceWorker, states: ServiceWorkerState[]) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(finish, 90_000, false)
    function finish(ok: boolean) {
      clearTimeout(timer)
      worker.removeEventListener('statechange', changed)
      if (ok) {
        resolve()
      } else {
        reject(new Error('新版资源尚未准备好，请稍后重试。'))
      }
    }
    function changed() {
      if (states.includes(worker.state)) {
        finish(true)
      } else if (worker.state === 'redundant') {
        finish(false)
      }
    }
    worker.addEventListener('statechange', changed)
    changed()
  })
}

export interface ReleaseProgress {
  completed: number
  total: number
}

async function waitForResources(worker: ServiceWorker, build: string, report: (progress: ReleaseProgress) => void) {
  // Each cache entry has already passed the installer's SHA-256 check and completed its write.
  const ports = new Set<MessagePort>()
  function sample() {
    if (worker.state !== 'installing' || ports.size) {
      return
    }
    const channel = new MessageChannel()
    ports.add(channel.port1)
    channel.port1.onmessage = ({ data }) => {
      channel.port1.close()
      ports.delete(channel.port1)
      if (Number.isSafeInteger(data?.total) && data.total > 0 && Number.isSafeInteger(data.completed) && data.completed >= 0 && data.completed <= data.total) {
        report(data)
      }
    }
    worker.postMessage({ type: 'web-release-progress', build }, [channel.port2])
  }
  const timer = window.setInterval(sample, 500)
  try {
    sample()
    await waitFor(worker, ['installed', 'activating', 'activated'])
  } finally {
    clearInterval(timer)
    for (const port of ports) {
      port.close()
    }
  }
}

export async function activateRelease(build: string, report: (progress: ReleaseProgress) => void, switching: () => void) {
  if (!('serviceWorker' in navigator)) {
    return
  }
  const registration = await navigator.serviceWorker.register('/tbox-offline-sw.js', { scope: '/', updateViaCache: 'none' })
  await registration.update()
  const worker = registration.installing || registration.waiting || registration.active
  if (!worker) {
    throw new Error('新版尚未就绪，请重试。')
  }
  await waitForResources(worker, build, report)
  switching()
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel()
    const timer = window.setTimeout(finish, 6000, false)
    function finish(ok: boolean) {
      clearTimeout(timer)
      channel.port1.close()
      if (ok) {
        resolve()
      } else {
        reject(new Error('新版正在发布，请稍后重试。'))
      }
    }
    channel.port1.onmessage = (event) => finish(event.data === true)
    worker.postMessage({ type: 'activate-web-release', build }, [channel.port2])
  })
  await waitFor(worker, ['activated'])
}
