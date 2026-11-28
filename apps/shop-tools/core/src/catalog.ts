import type { CatalogContent, CatalogSku, CollectedProduct, SourceSku } from '@t-box/shop-tools-contracts'
import { ShopError } from '@t-box/shop-tools-contracts'
import { calculate } from './index.js'

function text(v: unknown, max: number, required = false) {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) {
    throw ShopError.invalid('商品文字字段无效')
  }
  return v
}
function url(v: unknown) {
  const value = text(v, 4000)
  if (!value) {
    return ''
  }
  try {
    if (['https:', 'http:'].includes(new URL(value).protocol)) {
      return value
    }
  } catch {}
  throw ShopError.invalid('商品链接必须是 HTTP 或 HTTPS')
}
function array<T>(v: unknown, max: number): T[] {
  if (!Array.isArray(v) || v.length > max) {
    throw ShopError.invalid('商品列表数量超限')
  }
  return v
}
function pairs(v: unknown) {
  return array<{ name: unknown, value: unknown }>(v ?? [], 500).map((a) => ({ name: text(a.name, 500), value: text(a.value, 4000) }))
}
export function parseCollected(value: unknown): CollectedProduct {
  if (!value || typeof value !== 'object') {
    throw ShopError.invalid('商品资料无效')
  }
  const v = value as CollectedProduct
  const money = (n: unknown) => n === null || n === undefined ? null : text(String(n), 80)
  return { id: text(v.id, 200, true), platform: text(v.platform, 80, true), platformName: text(v.platformName, 100), sourceId: text(v.sourceId, 200), sourceUrl: url(v.sourceUrl), title: text(v.title, 1000, true), description: text(v.description, 100000), capturedAt: text(v.capturedAt, 80), price: { amount: money(v.price?.amount), currency: v.price?.currency ? text(v.price.currency, 8) : null }, assets: array<CollectedProduct['assets'][number]>(v.assets ?? [], 500).map((a) => ({ url: url(a.url), role: text(a.role, 30) })), attributes: pairs(v.attributes), packaging: pairs(v.packaging), variants: array<SourceSku>(v.variants ?? [], 1000).map((a) => ({ id: text(a.id, 200, true), sku: text(a.sku ?? '', 200), attributes: pairs(a.attributes), price: money(a.price), currency: a.currency ? text(a.currency, 8) : null, images: array<string>(a.images ?? [], 100).map(url) })) }
}
export function parseCatalogContent(value: unknown, currency: string, previous?: CatalogContent): CatalogContent {
  const v = value as CatalogContent
  if (!v || !Array.isArray(v.skus) || !v.skus.length) {
    throw ShopError.invalid('至少保留一个 SKU')
  }
  const ids = new Set<string>()
  const mediaIds = new Set<string>()
  if (v.media !== undefined) {
    for (const a of array<import('@t-box/shop-tools-contracts').CatalogMedia>(v.media, 10000)) {
      if (!a || typeof a.id !== 'string' || mediaIds.has(a.id) || !a.id.startsWith('image:') || !Number.isSafeInteger(a.position) || a.position < -1 || a.position > 10000 || (a.skuId !== null && !v.skus.some((s) => s.id === a.skuId))) {
        throw ShopError.invalid('图片标识、位置或所属 SKU 无效')
      }
      mediaIds.add(a.id)
    }
  }
  return { title: text(v.title, 1000, true), description: text(v.description, 100000), images: array<string>(v.images, 500).map(url), ...(v.media ? { media: array<import('@t-box/shop-tools-contracts').CatalogMedia>(v.media, 10000).map((a) => ({ id: text(a.id, 160, true), skuId: a.skuId === null ? null : text(a.skuId, 80, true), position: Number(a.position), url: url(a.url), ...(a.fileId ? { fileId: text(a.fileId, 80, true) } : {}) })) } : previous?.media ? { media: previous.media } : {}), videos: array<string>(v.videos === undefined ? previous?.videos ?? [] : v.videos, 500).map(url), ...(v.imageFileId ? { imageFileId: text(v.imageFileId, 200) } : {}), skus: array<CatalogSku>(v.skus, 1000).map((s) => {
    const id = text(s.id, 80, true)
    if (ids.has(id)) {
      throw ShopError.invalid('SKU 标识重复')
    }
    ids.add(id)
    if (s.cost !== null && (typeof s.cost !== 'number' || !Number.isFinite(s.cost) || s.cost < 0)) {
      throw ShopError.invalid('采购成本无效')
    }
    if (s.price !== null && (typeof s.price !== 'number' || !Number.isFinite(s.price) || s.price < 0 || s.currency !== currency)) {
      throw ShopError.invalid('SKU 售价或币种无效')
    }
    let pricing = s.pricing
    if (pricing) {
      if (pricing.row.id !== id || pricing.route.currency !== currency || Number(pricing.row.cost) !== s.cost) {
        throw ShopError.invalid('计价成本或币种与 SKU 不一致，请重新算价')
      }
      const result = calculate(pricing.row, pricing.settings, pricing.route)
      if (Math.abs(result.price - Number(s.price)) > 0.000001) {
        throw ShopError.invalid('计价结果与售价不一致')
      }
      pricing = { ...pricing, sheetId: text(pricing.sheetId, 80), sheetName: text(pricing.sheetName, 100), result, time: new Date().toISOString() }
    }
    return { id, images: array<string>(s.images === undefined ? previous?.skus.find((old) => old.id === id)?.images ?? [] : s.images, 100).map(url), code: text(s.code, 200), name: text(s.name, 1000, true), sourceSkuId: s.sourceSkuId === null ? null : text(s.sourceSkuId, 200), cost: s.cost, price: s.price, currency, pricing }
  }) }
}

/** Hydrate only absent legacy fields; never match by row position or restore deliberately removed media. */
export function restoreCatalogMedia(content: CatalogContent, source?: CollectedProduct): CatalogContent {
  return { ...content, videos: content.videos ?? [...new Set(source?.assets.filter((a) => a.role === 'video').map((a) => a.url) ?? [])], skus: content.skus.map((sku) => {
    const matches = sku.sourceSkuId ? source?.variants.filter((v) => v.id === sku.sourceSkuId) ?? [] : []
    return { ...sku, images: sku.images ?? (matches.length === 1 ? [...matches[0]!.images] : []) }
  }) }
}
