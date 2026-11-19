import { parseList } from '../dianxiaomi/normalize'

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js') || message?.target !== 'parser') {
    return
  }
  if (typeof message.raw !== 'string' || message.raw.length > 10_000_000) {
    reply({ ok: false, error: '列表内容超过解析限制' })
    return
  }
  try {
    reply({ ok: true, data: parseList(message.raw, message.expectedPage) })
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.message : '解析失败' })
  }
})
