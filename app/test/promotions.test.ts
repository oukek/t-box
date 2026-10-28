import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

test('promotion visit survives redirect, expires and clears; WeChat sharing keeps personal links and payment APIs', async () => {
  const first = '0123456789abcdef0123456789abcdef'
  const second = 'abcdef0123456789abcdef0123456789'
  const entry = 'https://tboxos.cn/?ref=' + first
  const dom = new JSDOM('', { url: entry })
  Object.defineProperty(dom.window.navigator, 'userAgent', { configurable: true, value: 'iPhone MicroMessenger/8.0 Mobile' })
  const globals = ['window', 'document', 'location', 'history', 'localStorage', 'navigator'] as const
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of globals) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'silent' })
  try {
    const visit = await server.ssrLoadModule('/src/features/promotions/attribution.ts')
    visit.capturePromotionLink()
    assert.equal(visit.promotionToken(), first)
    history.replaceState(null, '', '/?ref=' + second)
    visit.capturePromotionLink()
    assert.equal(visit.promotionToken(), first, 'The initial pre-registration source is retained')
    const resumed = await server.ssrLoadModule('/src/features/promotions/attribution.ts?resumed')
    assert.equal(resumed.promotionToken(), first)
    visit.clearPromotionVisit()
    assert.equal(visit.promotionToken(), undefined)
    localStorage.setItem('tbox.promotion.visit.v1', JSON.stringify({ token: second, expiresAt: Date.now() - 1 }))
    assert.equal(visit.promotionToken(), undefined)
    history.replaceState(null, '', '/?ref=invalid')
    visit.capturePromotionLink()
    assert.equal(visit.promotionToken(), undefined)
    history.replaceState(null, '', '/?ref=' + first)
    const configurations: { jsApiList: string[] }[] = []
    const messages: { link: string }[] = []
    const timelines: { link: string }[] = []
    Object.assign(dom.window, { wx: {
      config(value: { jsApiList: string[] }) {
        configurations.push(value)
      },
      ready(callback: () => void) {
        queueMicrotask(callback)
      },
      error() {},
      updateAppMessageShareData(value: { link: string, success(): void }) {
        messages.push(value)
        value.success()
      },
      updateTimelineShareData(value: { link: string, success(): void }) {
        timelines.push(value)
        value.success()
      },
    } })
    const module = await server.ssrLoadModule('/src/core/wechatSdk.ts')
    history.replaceState(null, '', '/#/applications')
    assert.equal(module.wechatSigningUrl(), entry, 'iOS signing uses the original document URL before query cleanup')
    const configuration = { appId: 'wxfixture', timestamp: 1, nonceStr: 'fixture', signature: 'fixture' }
    const [sdk] = await Promise.all([module.configureWechatSdk(configuration), module.configureWechatSdk(configuration)])
    assert.equal(configurations.length, 2)
    assert.ok(configurations.every((value) => ['chooseWXPay', 'updateAppMessageShareData', 'updateTimelineShareData'].every((api) => value.jsApiList.includes(api))))
    await module.updateWechatShareData(sdk, { title: 'T方舟', desc: '分享', link: entry, imgUrl: 'https://tboxos.cn/promotion/wechat-share-300.jpg' })
    assert.equal(messages.at(-1)!.link, entry)
    assert.equal(timelines.at(-1)!.link, entry)
    module.clearWechatShareData({ title: 'T方舟', desc: '分享', link: 'https://tboxos.cn/', imgUrl: 'https://tboxos.cn/promotion/wechat-share-300.jpg' })
    assert.equal(messages.at(-1)!.link, 'https://tboxos.cn/', 'Logging out removes the previous personal source from menu sharing')
  } finally {
    await server.close()
    dom.window.close()
    for (const key of globals) {
      const descriptor = previous.get(key)
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, key)
      }
    }
  }
})
