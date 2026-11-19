import { isDianxiaomi } from '../dianxiaomi/request'
import contentStyle from './content.css?inline'

function mount() {
  if (document.querySelector('[data-tark-ui="panel"]')) {
    return
  }
  const host = document.createElement('div')
  host.dataset.tarkUi = 'panel'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = contentStyle
  const dock = document.createElement('div')
  dock.className = 'dock'
  const toggle = document.createElement('button')
  toggle.className = 'brand'
  toggle.textContent = 'T方舟 · 采集箱'
  toggle.setAttribute('aria-expanded', 'false')
  const panel = document.createElement('section')
  panel.className = 'panel'
  panel.hidden = true
  panel.setAttribute('aria-label', 'T方舟采集预览')
  const status = document.createElement('div')
  status.className = 'status'
  status.setAttribute('role', 'status')
  status.hidden = true
  let iframe: HTMLIFrameElement | undefined
  const close = () => {
    panel.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
    toggle.focus()
  }
  async function open() {
    try {
      if (!iframe) {
        const result = await chrome.runtime.sendMessage({ action: 'page-context' })
        if (!result?.ok || !result.data?.tabId) {
          throw new Error('插件连接失效，请刷新网页')
        }
        const header = document.createElement('header')
        header.textContent = 'T方舟 · 采集箱'
        const collapse = document.createElement('button')
        collapse.textContent = '收起'
        collapse.onclick = close
        header.append(collapse)
        iframe = document.createElement('iframe')
        iframe.title = 'T方舟采集预览与详情'
        iframe.src = chrome.runtime.getURL(`index.html?embedded=1&sourceTab=${result.data.tabId}`)
        panel.append(header, iframe)
      }
      panel.hidden = false
      toggle.setAttribute('aria-expanded', 'true')
      iframe.focus()
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '打开失败，请刷新网页'
      status.hidden = false
    }
  }
  toggle.onclick = () => panel.hidden ? void open() : close()
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === 'open-panel') {
      void open()
    }
  })
  window.addEventListener('message', (event) => {
    if (event.source === iframe?.contentWindow && event.origin === new URL(chrome.runtime.getURL('/')).origin && event.data?.action === 'tark-close-panel') {
      close()
    }
  })
  dock.append(toggle)
  shadow.append(style, dock, status, panel)
  document.documentElement.append(host)
}
if (isDianxiaomi(location.href) && window === window.top) {
  mount()
}
