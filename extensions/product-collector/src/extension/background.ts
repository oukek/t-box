import type { Product, Session } from '../core/types'
import type { parseList } from '../dianxiaomi/normalize'
import { emptySession, mergeProducts } from '../core/session'
import { fetchListInPage, isDianxiaomi, listBody } from '../dianxiaomi/request'
import { authAction } from './auth'

const KEY = 'tark-dianxiaomi-preview-v1'
let state: Session = emptySession()
let writing = Promise.resolve()
let importing = false
let parserCreation: Promise<void> | null = null
const ready = chrome.storage.session.get(KEY).then((stored) => {
  state = (stored[KEY] as Session | undefined) || emptySession()
})
async function change(update: (session: Session) => Session) {
  const job = writing.then(async () => {
    await ready
    const next = update(structuredClone(state))
    await chrome.storage.session.set({ [KEY]: next })
    state = next
  })
  writing = job.catch(() => {})
  return job
}
async function tabFor(id: unknown) {
  if (!Number.isSafeInteger(id) || Number(id) < 1) {
    throw new Error('请从店小秘页面内打开采集箱')
  }
  const tab = await chrome.tabs.get(Number(id))
  if (!tab.url || !isDianxiaomi(tab.url)) {
    throw new Error('来源页面已离开店小秘，请重新打开采集箱')
  }
  return tab
}
async function parse(raw: string, expectedPage: number): Promise<ReturnType<typeof parseList>> {
  if (!(await chrome.offscreen.hasDocument())) {
    parserCreation ||= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.DOM_PARSER], justification: '解析店小秘商品描述中的文本和图片，不执行商品 HTML' }).finally(() => {
      parserCreation = null
    })
    await parserCreation
  }
  const result = await chrome.runtime.sendMessage({ target: 'parser', raw, expectedPage })
  if (!result?.ok) {
    throw new Error(result?.error || '商品解析失败')
  }
  return result.data
}
async function importPage(message: Record<string, unknown>) {
  if (importing) {
    throw new Error('已有列表读取任务，请稍后重试')
  }
  const pageNo = Number(message.pageNo)
  const body = listBody(pageNo, Number(message.pageSize), typeof message.searchValue === 'string' ? message.searchValue : '')
  importing = true
  try {
    const tab = await tabFor(message.tabId)
    const [execution] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', func: fetchListInPage, args: [body] })
    if (!execution?.result?.raw) {
      throw new Error(execution?.result?.error || '读取未完成，请刷新店小秘页面后重试')
    }
    const parsed = await parse(execution.result.raw, pageNo)
    let result = { ...parsed.page, received: parsed.products.length + parsed.skipped, skipped: parsed.skipped, warnings: parsed.warnings, added: 0, updated: 0 }
    await change((session) => {
      const merged = mergeProducts(session, parsed.products as Product[])
      result = { ...result, added: merged.added, updated: merged.updated }
      return { ...merged.session, lastImport: result }
    })
    return result
  } finally {
    importing = false
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.target === 'parser') {
    return
  }
  const embedded = sender.url?.startsWith(chrome.runtime.getURL('index.html'))
  const page = sender.frameId === 0 && sender.url && isDianxiaomi(sender.url)
  if (!embedded && !page) {
    return
  }
  void (async () => {
    await ready
    if (message.action === 'page-context' && page) {
      return { tabId: sender.tab?.id }
    }
    if (!embedded) {
      throw new Error('请从采集箱操作')
    }
    if (message.action === 'confirm-collect') {
      if (!Array.isArray(message.ids) || !message.ids.length || message.ids.length > 200) {
        throw new Error('请选择要确认采集的商品')
      }
      const products = state.products.filter((p) => message.ids.includes(p.id))
      if (products.length !== new Set(message.ids).size) {
        throw new Error('商品已变化，请重新选择')
      }
      const result = await authAction('account-collect', { products, userId: message.userId }) as { confirmed: number[], error: string }
      return { ids: result.confirmed.map((i) => products[i]!.id), error: result.error }
    }
    if (message.action === 'account-collect') {
      throw new Error('请使用确认采集入口')
    }
    if (message.action === 'account' || message.action?.startsWith('account-')) {
      return authAction(message.action, message)
    }
    if (message.action === 'session') {
      return state
    }
    if (message.action === 'import-page') {
      return importPage(message)
    }
    if (message.action === 'remove') {
      if (!Array.isArray(message.ids)) {
        throw new TypeError('商品选择无效')
      }
      await change((session) => ({ ...session, products: session.products.filter((p) => !message.ids.includes(p.id)) }))
      return true
    }
    throw new Error('不支持的操作')
  })().then((data) => reply({ ok: true, data }), (error) => reply({ ok: false, error: error instanceof Error ? error.message : '操作失败' }))
  return true
})
chrome.action.onClicked.addListener((tab) => {
  if (tab.id && tab.url && isDianxiaomi(tab.url)) {
    void chrome.tabs.sendMessage(tab.id, { action: 'open-panel' }).catch(() => {})
  }
})
