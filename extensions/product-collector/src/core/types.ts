export interface Asset {
  url: string
  role: 'main' | 'detail' | 'variant' | 'size-chart' | 'video' | 'instruction'
  source: string
}
export interface Attribute {
  name: string
  value: string
}
export interface Variant {
  id: string
  sku: string
  attributes: Attribute[]
  price: string | null
  currency: string | null
  stock: number | null
  images: string[]
}
export interface Price {
  amount: string | null
  maximum: string | null
  original: string | null
  discount: string | null
  currency: string | null
  tiers: { minimum: number, maximum: number | null, amount: string }[]
}
export interface Evidence {
  field: string
  source: string
}
export interface Product {
  id: string
  platform: string
  platformName: string
  sourceId: string
  sourceUrl: string
  capturedAt: string
  title: string
  description: string
  brand: string
  sku: string
  spu: string
  category: { id: string, path: string[] }
  tags: string[]
  price: Price
  stock: number | null
  sold: number | null
  seller: { name: string, url: string }
  attributes: Attribute[]
  assets: Asset[]
  variants: Variant[]
  packaging: Attribute[]
  evidence: Evidence[]
  missing: string[]
  warnings: string[]
  status: 'partial' | 'review'
  // Only product-scoped information; never cookies or entire application state.
  sourceData: { source: string, data: unknown }[]
}
export interface PageInfo {
  pageNo: number
  pageSize: number
  totalPage: number
  totalSize: number
}
export interface ImportResult extends PageInfo {
  received: number
  added: number
  updated: number
  skipped: number
  warnings: string[]
}
export interface Session {
  products: Product[]
  lastImport: ImportResult | null
}
