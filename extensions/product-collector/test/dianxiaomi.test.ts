import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { emptySession, mergeProducts } from '../src/core/session'
import { normalizeProduct, parseList } from '../src/dianxiaomi/normalize'
import { isDianxiaomi, listBody } from '../src/dianxiaomi/request'

const dom = new JSDOM('')
globalThis.DOMParser = dom.window.DOMParser
const row = {
  id: Number('184527809356515393'),
  idStr: '184527809356515393',
  platform: 'supplier',
  productId: '12345',
  name: '测试商品',
  sourceCurrency: 'CNY',
  sourcePrice: 0.22,
  price: 0.03,
  quantity: 0,
  puid: 321,
  createName: 'private-operator',
  createId: 321,
  collectStatus: 'SUCCESS',
  detail: '<script>bad()</script><p>说明 &amp; 材质</p><img src="https://images.example/detail.jpg"><img src="javascript:alert(1)">',
  imgUrl: 'https://images.example/main.jpg|https://images.example/main.jpg',
  itemSpecifics: '材质:TPR\n品牌：无品牌',
  packageInfo: '{"weight":"0.015","length":"0.0"}',
  variant: JSON.stringify([{ productId: 6251899050784, sourcePrice: 0, sourceCurrency: 'CNY', quantity: 0, attribute: '{"颜色":"白色"}', imageUrls: 'https://images.example/white.jpg', puid: 321 }]),
}
function response(list: unknown[] = [row], pageNo = 1) {
  return JSON.stringify({ code: 0, data: { page: { pageNo, pageSize: 50, totalPage: 2, totalSize: 51, list } } })
}
test('maps nested variants, source currency, zero values, detail images and packaging', () => {
  const p = normalizeProduct(row)
  assert.equal(p.price.amount, '0.22')
  assert.equal(p.price.currency, 'CNY')
  assert.equal(p.stock, 0)
  assert.equal(p.variants[0].price, '0')
  assert.equal(p.variants[0].stock, 0)
  assert.equal(p.variants[0].attributes[0].value, '白色')
  assert.equal(p.description, '说明 & 材质')
  assert.equal(p.assets.filter((a) => a.role === 'main').length, 1)
  assert.equal(p.assets.filter((a) => a.role === 'detail').length, 1)
  assert.equal(p.packaging[0].value, '0.015')
  assert.equal(p.brand, '无品牌')
  const raw = JSON.stringify(p.sourceData)
  assert.ok(raw.includes('184527809356515393'))
  assert.ok(!raw.includes('puid'))
  assert.ok(!raw.includes('private-operator'))
})
test('large IDs use idStr, unsafe numeric fallback is rejected', () => {
  const p = normalizeProduct({ ...row, platform: '', productId: '' })
  assert.equal(p.id, 'dxm:184527809356515393')
  assert.throws(() => normalizeProduct({ ...row, idStr: '', platform: '', productId: '' }), /编号/)
})
test('deduplication updates by source identity across record IDs and preserves other products', () => {
  const p = normalizeProduct(row)
  const updated = normalizeProduct({ ...row, idStr: 'new-record', name: '更新标题' })
  const first = mergeProducts(emptySession(), [p, p])
  assert.equal(first.added, 1)
  const second = mergeProducts(first.session, [updated])
  assert.equal(second.updated, 1)
  assert.equal(second.session.products.length, 1)
  assert.equal(second.session.products[0].title, '更新标题')
  assert.notEqual(normalizeProduct({ ...row, platform: 'another' }).id, p.id)
})
test('rejects login/failed/malformed/mismatched page responses without inventing empty success', () => {
  assert.throws(() => parseList('<html>登录</html>', 1), /登录/)
  assert.throws(() => parseList('{"code":401,"msg":"登录失效"}', 1), /登录失效/)
  assert.throws(() => parseList('{"code":0,"data":{}}', 1), /缺少商品列表/)
  assert.throws(() => parseList(response([row], 1), 2), /分页/)
  const parsed = parseList(response([row, { ...row, collectStatus: 'FAILED' }]), 1)
  assert.equal(parsed.products.length, 1)
  assert.equal(parsed.skipped, 1)
})
test('malformed nested fields are explicitly warned; unknown currency stays unknown', () => {
  const p = normalizeProduct({ ...row, sourcePrice: null, currency: null, variant: '{bad', packageInfo: '{bad' })
  assert.equal(p.price.currency, null)
  assert.equal(p.variants.length, 0)
  assert.ok(p.warnings.some((w) => w.includes('规格格式异常')))
})
test('page body preserves all required parameters and domain activation is exact', () => {
  const body = new URLSearchParams(listBody(3, 50, '中文 & 商品'))
  assert.equal(body.get('pageNo'), '3')
  assert.equal(body.get('site'), 'all')
  assert.equal(body.get('searchValue'), '中文 & 商品')
  assert.equal(body.get('commentValue'), '')
  assert.equal(body.get('orderValue'), '')
  assert.deepEqual([...body.keys()].sort(), ['pageNo', 'pageSize', 'site', 'searchValue', 'productSearchType', 'sortTime', 'accountName', 'commentType', 'commentValue', 'sourcePriceUsdMin', 'sourcePriceUsdMax', 'orderName', 'orderValue'].sort())
  assert.throws(() => listBody(0, 50))
  assert.throws(() => listBody(1, 51))
  assert.ok(isDianxiaomi('https://www.dianxiaomi.com/web/productCrawl/dataAcquisition'))
  for (const host of ['https://dianxiaomi.com', 'http://www.dianxiaomi.com', 'https://www.dianxiaomi.com.evil.test', 'https://example.test/?url=https://www.dianxiaomi.com']) {
    assert.equal(isDianxiaomi(host), false)
  }
})
test('capacity failure is atomic and never evicts existing products', () => {
  const p = normalizeProduct(row)
  const session = { ...emptySession(), products: Array.from({ length: 200 }, (_, index) => ({ ...p, id: String(index) })) }
  assert.throws(() => mergeProducts(session, [p]), /200/)
  assert.equal(session.products.length, 200)
  assert.equal(session.products[0].id, '0')
})
