import type { Product, Result, Route, Settings } from './index.js'

export const projectSites = [
  { value: 'MY', label: '马来西亚 · Shopee MY', currency: 'MYR' },
  { value: 'SG', label: '新加坡 · Shopee SG', currency: 'SGD' },
  { value: 'TH', label: '泰国 · Shopee TH', currency: 'THB' },
  { value: 'TW', label: '中国台湾 · Shopee TW', currency: 'TWD' },
  { value: 'ID', label: '印度尼西亚 · Shopee ID', currency: 'IDR' },
  { value: 'PH', label: '菲律宾 · Shopee PH', currency: 'PHP' },
  { value: 'VN', label: '越南 · Shopee VN', currency: 'VND' },
  { value: 'BR', label: '巴西 · Shopee BR', currency: 'BRL' },
] as const
export interface SourceSku { id: string, sku: string, attributes: { name: string, value: string }[], price: string | null, currency: string | null, images: string[] }
export interface CollectedProduct {
  id: string
  platform: string
  platformName: string
  sourceId: string
  sourceUrl: string
  title: string
  description: string
  capturedAt: string
  price: { amount: string | null, currency: string | null }
  assets: { url: string, role: string }[]
  attributes: { name: string, value: string }[]
  packaging: { name: string, value: string }[]
  variants: SourceSku[]
}
export interface CollectionItem { id: string, data: CollectedProduct, createdAt: string }
export interface PricingSnapshot { sheetId: string, sheetName: string, row: Product, settings: Settings, route: Route, result: Result, time: string }
export interface CatalogSku { id: string, code: string, name: string, sourceSkuId: string | null, cost: number | null, price: number | null, currency: string, pricing: PricingSnapshot | null }
export interface CatalogContent { title: string, description: string, images: string[], imageFileId?: string, skus: CatalogSku[] }
export interface CatalogProduct { id: string, project: string, source: string, title: string, modified: boolean, createdAt: string }
export interface CatalogVersion { id: string, product: string, name: string, revision: number, content: CatalogContent, createdAt: string }
export interface CatalogDetail { product: CatalogProduct, versions: CatalogVersion[] }
