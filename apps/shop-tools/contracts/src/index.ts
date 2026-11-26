import type { ApplicationManifest } from '@t-box/app-contracts'
import { applicationIcon } from './icon.js'

export { ShopError } from './error-codes.js'
export const manifest = {
  id: 'shop-tools',
  name: '电商助手',
  description: 'Shopee 商品定价、物流与汇率工具，支持按模板优化商品文案和图片',
  icon: 'apps',
  iconAsset: applicationIcon,
  color: 'orange',
  version: '1.3.5',
  skillIds: [],
} as const satisfies ApplicationManifest
export const currencies = [
  ['CNY', '人民币', 'CN'],
  ['MYR', '马来西亚林吉特', 'MY'],
  ['SGD', '新加坡元', 'SG'],
  ['THB', '泰铢', 'TH'],
  ['TWD', '新台币', 'TW'],
  ['IDR', '印尼盾', 'ID'],
  ['PHP', '菲律宾比索', 'PH'],
  ['VND', '越南盾', 'VN'],
  ['BRL', '巴西雷亚尔', 'BR'],
  ['CLP', '智利比索', 'CL'],
  ['COP', '哥伦比亚比索', 'CO'],
  ['MXN', '墨西哥比索', 'MX'],
  ['ARS', '阿根廷比索', 'AR'],
] as const
export type Mode = 'profit' | 'profitRate' | 'price'
export const modes = [
  { value: 'profit', label: '按利润（目标 CNY）' },
  { value: 'profitRate', label: '按利润率（目标 %）' },
  { value: 'price', label: '按售价（目标本币）' },
] as const
export const inputs = [
  ['sku', 'SKU'],
  ['name', '商品名称'],
  ['cost', '成本（CNY）'],
  ['weight', '重量（kg）'],
  ['domestic', '境内运费（CNY）'],
  ['target', '目标值'],
  ['discount', '折扣（%）'],
  ['activity', '活动费（%）'],
  ['withdraw', '提现费（%）'],
  ['loss', '预留汇损（%）'],
] as const
export type InputKey = (typeof inputs)[number][0]
export type Product = Record<InputKey, string | number> & { id: string }
export interface Fee {
  type: 'Seller' | 'Buyer'
  name: 'Flat' | 'WeightRange' | 'Increment'
  original_fee?: number
  start_weight?: number
  end_weight?: number
  increment_unit?: number
  increment_amount?: number
  [key: string]: unknown
}
export interface Coupon {
  threshold: number
  reduction: number
}
export interface Route {
  coupons?: Coupon[]
  precision?: number
  key: string
  site: string
  siteName: string
  currency: string
  cargo: string
  channel: string
  region: string
  label: string
  path: string[]
  fees: Fee[]
  exchange: number
  commission: number
  trade: number
}
export interface Settings {
  date: string
  routeKey: string
  mode: Mode
}
export interface Sheet {
  id: string
  name: string
  settings: Settings
  rows: Product[]
}
export interface Book {
  version: 1
  activeSheetId: string
  sheets: Sheet[]
}
export interface Config {
  creativeTemplates?: CreativeTemplate[]
  basic: Record<string, string | number>
  order: string[]
  sites: Record<
    string,
    { enabled: boolean, precision?: number, disabled: string[], coupons?: Coupon[] }
  >
}
export interface Quote {
  rates: Record<string, number>
  updatedAt: string
  source: string
}
export interface SiteData {
  name: string
  cn_name: string
  currency_unit?: string
  platform_commission?: number | string
  handling_fee?: number | string
}
export interface ShippingSite {
  name: string
  cargo_types: {
    name: string
    cn_name: string
    channels: {
      name: string
      cn_name: string
      zones: { name: string, cn_name?: string, fee_modes: Fee[] }[]
    }[]
  }[]
}
export interface SitePayload {
  sites: SiteData[]
  shipping: { site_info: ShippingSite[] }
}
export const outputs = [
  ['price', '折前售价'],
  ['sale', '折后售价'],
  ['coupon', '优惠券减免'],
  ['paid', '券后成交价'],
  ['profit', '汇损后利润（CNY）'],
  ['margin', '净利润率（%）'],
  ['hidden', '藏价'],
  ['buyer', '买家运费'],
  ['commission', '佣金'],
  ['trade', '交易手续费'],
  ['activity', '活动费'],
  ['withdraw', '提现手续费'],
  ['loss', '预留汇损金额'],
] as const
export type Result = Record<
  (typeof outputs)[number][0] | 'revenue' | 'pricingExchange',
  number
> & { sellerFormula: string, buyerFormula: string }

export interface DetailSnapshot {
  row: Product
  result: Result
  route: Route
  time: string
}
export interface ComparisonSnapshot {
  row: Product
  settings: Settings
  entries: { route: Route, result: Result | null, error: string }[]
  createdAt: string
}
export interface WorkspaceState {
  book: Book
  config: Config
  detail: DetailSnapshot | null
  comparison: ComparisonSnapshot | null
}
export interface WorkspaceMetadata {
  activeSheetId: string
  sheets: Omit<Sheet, 'rows'>[]
}
export interface ProductUpdate {
  sheetId: string
  position: number
  row: Product
}
export interface WorkspacePatch {
  revision: number
  metadata?: WorkspaceMetadata
  config?: Config
  history?: Pick<WorkspaceState, 'detail' | 'comparison'>
  upserts: ProductUpdate[]
  removals: { sheetId: string, id: string }[]
}
export interface WorkspaceHeader {
  revision: number
  metadata: WorkspaceMetadata | null
  config: Config | null
  history: Pick<WorkspaceState, 'detail' | 'comparison'> | null
}
export interface ProductPage {
  items: ProductUpdate[]
  nextOffset: number | null
}

export type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer'
export interface ProjectSummary {
  id: string
  name: string
  role: ProjectRole
}
export interface ProjectMember {
  subject: string
  name: string
  role: ProjectRole
}
export interface ProjectInvite {
  id: string
  role: Exclude<ProjectRole, 'owner'>
  expiresAt: string
  remaining: number
}

export interface CreativeRules {
  title: string
  description: string
  image: string
  language: string
}
export interface CreativeTemplate extends CreativeRules {
  id: string
  name: string
}
export interface CreativeInput {
  title: string
  description: string
  imageId: string
  fields: ('title' | 'description' | 'image')[]
  rules: CreativeRules
}
export interface Creation {
  id: string
  input: CreativeInput
  output: Partial<Record<'title' | 'description' | 'image', string>>
  errors: string[]
  status: 'running' | 'finished'
  createdAt: string
}
