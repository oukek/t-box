// Only the first-party site receives this script; never expose extension credentials.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.action !== 'collector-account') {
    return
  }
  const id = crypto.randomUUID()
  let timer: ReturnType<typeof setTimeout>
  const receive = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'tbox.collector.account.result' || event.data.id !== id) {
      return
    }
    clearTimeout(timer)
    window.removeEventListener('message', receive)
    reply(event.data.user || null)
  }
  timer = setTimeout(() => {
    window.removeEventListener('message', receive)
    reply(null)
  }, 6000)
  window.addEventListener('message', receive)
  window.postMessage({ type: 'tbox.collector.account', id }, location.origin)
  return true
})
