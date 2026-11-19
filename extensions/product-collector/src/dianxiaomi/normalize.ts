import type { Asset, Attribute, PageInfo, Product, Variant } from '../core/types'
import { count, decimal, object, sanitize, text } from '../core/values'

function json(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('商品嵌套 JSON 格式错误')
  }
}
function id(value: unknown) {
  return typeof value === 'number' && !Number.isSafeInteger(value) ? '' : text(value)
}
function url(value: unknown) {
  try {
    const parsed = new URL(text(value), 'https://www.dianxiaomi.com')
    return text(value) && ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''
  } catch {
    return ''
  }
}
function urls(value: unknown) {
  const values = Array.isArray(value) ? value : text(value).split('|')
  return [...new Set(values.map(url).filter(Boolean))]
}
function attrs(value: unknown): Attribute[] {
  return Object.entries(object(value)).map(([name, value]) => ({ name, value: Array.isArray(value) ? value.map(text).join('、') : text(value) })).filter((entry) => entry.value !== '')
}
function properties(value: unknown): Attribute[] {
  return text(value).split('\n').map((line) => {
    const split = line.search(/[:：]/)
    return { name: split < 0 ? '' : line.slice(0, split).trim(), value: line.slice(split + 1).trim() }
  }).filter((entry) => entry.name && entry.value)
}
function pricing(row: Record<string, unknown>) {
  const source = decimal(row.sourcePrice)
  if (source !== null) {
    return { amount: source, currency: text(row.sourceCurrency) || null, discount: decimal(row.sourceDiscountPrice) }
  }
  return { amount: decimal(row.price), currency: text(row.currency) || null, discount: decimal(row.discountPrice) }
}
export function normalizeProduct(value: unknown): Product {
  const row = object(value)
  const recordId = id(row.idStr) || id(row.id)
  const sourceId = id(row.productId)
  const platform = text(row.platform)
  if (!recordId && !(platform && sourceId)) {
    throw new Error('缺少可安全识别的商品编号')
  }
  if (row.collectStatus && row.collectStatus !== 'SUCCESS') {
    throw new Error(`店小秘采集状态为 ${text(row.collectStatus)}`)
  }
  const warnings: string[] = []
  const parse = (value: unknown, field: string) => {
    try {
      return json(value)
    } catch {
      warnings.push(`${field}格式异常，未解析此字段`)
      return null
    }
  }
  const detail = new DOMParser().parseFromString(text(row.detail), 'text/html')
  detail.querySelectorAll('script,style,iframe,object,embed').forEach((el) => el.remove())
  const description = [text(row.description), detail.body.textContent?.trim()].filter(Boolean).join('\n').slice(0, 100000)
  const assets: Asset[] = []
  const add = (values: unknown, role: Asset['role'], source: string) => {
    for (const link of urls(values)) {
      if (!assets.some((a) => a.url === link && a.role === role)) {
        assets.push({ url: link, role, source })
      }
    }
  }
  add(row.imgUrl, 'main', 'imgUrl')
  add(row.previewImgUrl, 'main', 'previewImgUrl')
  add(row.previewImgs, 'main', 'previewImgs')
  for (const image of detail.querySelectorAll('img')) {
    add(image.getAttribute('src') || image.getAttribute('data-src'), 'detail', 'detail')
  }
  add(row.descImgs, 'detail', 'descImgs')
  add(row.videoUrl, 'video', 'videoUrl')
  add(row.sizeChartUrl, 'size-chart', 'sizeChartUrl')
  add(row.instructionUrl, 'instruction', 'instructionUrl')
  const variantsValue = parse(row.variant, '规格')
  if (variantsValue != null && !Array.isArray(variantsValue)) {
    warnings.push('规格结构不是数组，未解析规格')
  }
  const variants: Variant[] = (Array.isArray(variantsValue) ? variantsValue : []).map((value) => {
    const v = object(value)
    const price = pricing(v)
    add(v.imageUrls, 'variant', 'variant.imageUrls')
    return { id: id(v.skuId) || id(v.productId) || id(v.id), sku: text(v.sku), attributes: attrs(parse(v.attribute, '规格选项')), price: price.amount, currency: price.currency, stock: count(v.quantity), images: urls(v.imageUrls) }
  })
  const attributes = properties(row.itemSpecifics)
  const packaging = attrs(parse(row.packageInfo, '包装'))
  const labels: Record<string, string> = { length: '长度（源值）', width: '宽度（源值）', height: '高度（源值）', weight: '重量（源值）' }
  for (const item of packaging) {
    item.name = labels[item.name] || item.name
  }
  if (packaging.length) {
    warnings.push('包装尺寸和重量按接口原值保留，单位需核对；零值不代表已测量')
  }
  const price = pricing(row)
  if (price.amount !== null && !price.currency) {
    warnings.push('接口未明确价格币种，请核对')
  }
  const coverage: [string, boolean, string][] = [
    ['标题', !!text(row.name), 'name'],
    ['主图', assets.some((a) => a.role === 'main'), 'imgUrl'],
    ['价格', price.amount !== null, 'sourcePrice / price'],
    ['币种', !!price.currency, 'sourceCurrency / currency'],
    ['描述/详情图', !!description || assets.some((a) => a.role === 'detail'), 'detail'],
    ['规格', variants.length > 0, 'variant'],
    ['商品属性', attributes.length > 0, 'itemSpecifics'],
    ['包装信息', packaging.length > 0, 'packageInfo'],
  ]
  const kept = ['name', 'productId', 'platform', 'sourceName', 'sourceUrl', 'categoryId', 'categoryFullPath', 'price', 'discountPrice', 'currency', 'sourceCurrency', 'sourcePrice', 'sourcePriceUsd', 'sourceDiscountPrice', 'quantity', 'description', 'detail', 'detailJson', 'itemSpecifics', 'productPropertys', 'itemSpecificsNew', 'packageInfo', 'videoUrl', 'imgUrl', 'previewImgUrl', 'previewImgs', 'descImgs', 'colorImgs', 'variantImgs', 'variantColorUrl', 'variantMap', 'attribute', 'variationList', 'spu', 'sku', 'tag', 'sizeChartUrl', 'instructionUrl']
  // Only product fields: never retain owner IDs, operator names, permissions or account metadata.
  const sourceData = Object.fromEntries(kept.filter((key) => row[key] != null).map((key) => [key, row[key]]))
  sourceData.idStr = recordId
  sourceData.variant = (Array.isArray(variantsValue) ? variantsValue : []).map((value) => {
    const v = object(value)
    const keys = ['productId', 'skuId', 'name', 'imageUrls', 'price', 'discountPrice', 'sourceCurrency', 'sourcePrice', 'sourcePriceUsd', 'sourceDiscountPrice', 'quantity', 'attribute', 'skuWeight', 'skuLength', 'skuWidth', 'skuHeight']
    return Object.fromEntries(keys.filter((k) => v[k] != null).map((k) => [k, v[k]]))
  })
  const missing = coverage.filter(([, present]) => !present).map(([field]) => field)
  return {
    id: platform && sourceId ? `source:${JSON.stringify([platform.toLowerCase(), sourceId])}` : `dxm:${recordId}`,
    platform: platform || 'dianxiaomi',
    platformName: text(row.sourceName) || platform || '店小秘',
    sourceId: sourceId || recordId,
    sourceUrl: url(row.sourceUrl),
    capturedAt: new Date().toISOString(),
    title: text(row.name),
    description,
    brand: attributes.find((a) => a.name === '品牌')?.value || '',
    sku: text(row.sku),
    spu: text(row.spu),
    category: { id: text(row.categoryId), path: text(row.categoryFullPath) ? [text(row.categoryFullPath)] : [] },
    tags: text(row.tag) ? [text(row.tag)] : [],
    price: { ...price, maximum: null, original: null, tiers: [] },
    stock: count(row.quantity),
    sold: null,
    seller: { name: '', url: '' },
    attributes,
    assets,
    variants,
    packaging,
    evidence: coverage.filter(([, present]) => present).map(([field, , source]) => ({ field, source: `店小秘列表 · ${source}` })),
    missing,
    warnings,
    status: missing.length ? 'partial' : 'review',
    sourceData: [{ source: 'dianxiaomi.crawl.list', data: sanitize(sourceData) }],
  }
}
export function parseList(raw: string, expectedPage: number): { products: Product[], page: PageInfo, skipped: number, warnings: string[] } {
  let data: Record<string, unknown>
  try {
    data = object(JSON.parse(raw))
  } catch {
    throw new Error('接口未返回 JSON，请确认店小秘已登录且没有验证提示')
  }
  if (data.code !== 0) {
    throw new Error(`店小秘列表读取失败：${text(data.msg) || '请确认登录状态'}`)
  }
  const page = object(object(data.data).page)
  if (!Array.isArray(page.list)) {
    throw new TypeError('接口缺少商品列表，未导入任何资料')
  }
  const pageNo = count(page.pageNo)
  const pageSize = count(page.pageSize)
  const totalPage = count(page.totalPage)
  const totalSize = count(page.totalSize)
  if (pageNo !== expectedPage || !pageSize || totalPage === null || totalSize === null) {
    throw new Error('返回分页信息异常，请刷新后重试')
  }
  const products: Product[] = []
  const warnings: string[] = []
  page.list.forEach((row, index) => {
    try {
      products.push(normalizeProduct(row))
    } catch (error) {
      warnings.push(`第 ${index + 1} 条未导入：${error instanceof Error ? error.message : '资料异常'}`)
    }
  })
  return { products, page: { pageNo, pageSize, totalPage, totalSize }, skipped: warnings.length, warnings }
}
