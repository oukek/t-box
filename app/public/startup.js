// This small, dependency-free placeholder survives slow or failed module loading.
// Vue removes it when the workspace mounts.
(() => {
  const startup = document.getElementById('startup')
  const retry = document.getElementById('startup-retry')
  retry?.addEventListener('click', () => location.reload())
  const timeout = setTimeout(() => {
    if (!startup?.isConnected) {
      return
    }
    document.getElementById('startup-status').textContent = '打开时间较长，可以重试。'
    retry.hidden = false
  }, 12000)
  const observer = new MutationObserver(() => {
    if (startup?.isConnected) {
      return
    }
    clearTimeout(timeout)
    observer.disconnect()
  })
  observer.observe(document.getElementById('app'), { childList: true })
})()
