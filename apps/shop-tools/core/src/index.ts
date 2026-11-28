import type {
  Book,
  Config,
  Fee,
  Product,
  Result,
  Route,
  Settings,
  Sheet,
  ShippingSite,
  SiteData,
} from '@t-box/shop-tools-contracts'
import { currencies, inputs, ShopError } from '@t-box/shop-tools-contracts'

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
export function localDate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function defaultConfig(): Config {
  return {
    basic: {
      weight: '',
      domestic: '',
      activity: 1,
      withdraw: 1,
      discount: 0,
      loss: 4,
      precision: 2,
    },
    order: [],
    sites: {},
  }
}
export function newRow(defaults: Config['basic'] = {}): Product {
  return {
    id: crypto.randomUUID(),
    sku: '',
    name: '',
    cost: '',
    weight: defaults.weight ?? '',
    domestic: defaults.domestic ?? '',
    target: '',
    discount: defaults.discount ?? 0,
    activity: defaults.activity ?? 1,
    withdraw: defaults.withdraw ?? 1,
    loss: defaults.loss ?? 4,
  }
}
export function newSheet(name: string, defaults: Config['basic'] = {}): Sheet {
  return {
    id: crypto.randomUUID(),
    name,
    settings: { date: localDate(), mode: 'profit', routeKey: '' },
    rows: Array.from({ length: 5 }, () => newRow(defaults)),
  }
}
export function hasProduct(row: Product) {
  return ['sku', 'name', 'cost', 'target'].some((k) =>
    String(row[k as keyof Product] ?? '').trim(),
  )
}
export function validateBook(value: unknown): Book {
  const b = value as Book
  if (
    !b ||
    b.version !== 1 ||
    !Array.isArray(b.sheets) ||
    !b.sheets.length ||
    b.sheets.length > 20
  ) {
    throw ShopError.invalid('工作簿格式无效：最多20个工作表')
  }
  const ids = new Set<string>()
  for (const s of b.sheets) {
    if (
      !s ||
      typeof s.id !== 'string' ||
      ids.has(s.id) ||
      typeof s.name !== 'string' ||
      !s.name.trim() ||
      s.name.length > 100 ||
      !s.settings ||
      !['profit', 'profitRate', 'price'].includes(s.settings.mode) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.settings.date) ||
      !Array.isArray(s.rows) ||
      s.rows.length > 1000
    ) {
      throw ShopError.invalid('工作表格式无效：每表最多1000行')
    }
    ids.add(s.id)
    const rows = new Set<string>()
    for (const r of s.rows) {
      if (
        !r ||
        typeof r.id !== 'string' ||
        rows.has(r.id) ||
        inputs.some(
          ([k]) =>
            !['string', 'number'].includes(typeof r[k]) ||
            String(r[k]).length > 2000,
        )
      ) {
        throw ShopError.invalid('商品数据格式无效')
      }
      rows.add(r.id)
    }
  }
  if (!ids.has(b.activeSheetId)) {
    b.activeSheetId = b.sheets[0]!.id
  }
  return b
}
export function shipping(weight: number, fees: Fee[]) {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw ShopError.invalid('重量必须大于0')
  }
  const sum = (type: Fee['type']) => {
    const list = fees
      .filter((f) => f.type === type)
      .sort((a, b) => (a.start_weight ?? 0) - (b.start_weight ?? 0))
    const flat = list.find((f) => f.name === 'Flat')
    if (flat) {
      if (!Number.isFinite(flat.original_fee) || flat.original_fee! < 0) {
        throw ShopError.invalid('固定运费无效')
      }
      return { value: flat.original_fee!, formula: String(flat.original_fee) }
    }
    let value = 0
    const terms: string[] = []
    for (const f of list) {
      const start = Number(f.start_weight ?? 0)
      if (weight <= start) {
        continue
      }
      if (f.name === 'WeightRange') {
        const amount = Number(f.original_fee)
        if (!Number.isFinite(amount) || amount < 0) {
          throw ShopError.invalid('重量区间费用无效')
        }
        value += amount
        terms.push(String(amount))
      } else if (f.name === 'Increment') {
        const unit = Number(f.increment_unit)
        const amount = Number(f.increment_amount)
        if (!(unit > 0) || !Number.isFinite(amount) || amount < 0) {
          throw ShopError.invalid('续重费率无效')
        }
        const capped = Math.min(weight, Number(f.end_weight) || Infinity)
        value += Math.ceil((capped - start) / unit) * amount
        terms.push(`向上取整((${capped}-${start})/${unit})×${amount}`)
      } else {
        throw ShopError.invalid('不支持的物流规则，请检查官方数据')
      }
    }
    return { value, formula: terms.join(' + ') || '0' }
  }
  return { seller: sum('Seller'), buyer: sum('Buyer') }
}
export function calculate(
  row: Product,
  settings: Settings,
  route: Route,
): Result {
  const n = Object.fromEntries(
    inputs
      .filter(([k]) => k !== 'sku' && k !== 'name')
      .map(([k]) => [k, Number(row[k])]),
  ) as Record<string, number>
  for (const k of [
    'cost',
    'weight',
    'target',
    'discount',
    'activity',
    'withdraw',
    'loss',
  ]) {
    if (String(row[k as keyof Product]).trim() === '') {
      throw ShopError.invalid('请填写成本、重量、目标值和费率')
    }
  }
  if (
    Object.values(n).some((v) => !Number.isFinite(v)) ||
    !Number.isFinite(route.exchange) ||
    route.exchange <= 0 ||
    n.cost! <= 0 ||
    n.weight! <= 0 ||
    n.domestic! < 0 ||
    n.target! < 0
  ) {
    throw ShopError.invalid('请输入有效成本、重量、汇率和目标值')
  }
  for (const v of [
    n.discount,
    n.activity,
    n.withdraw,
    n.loss,
    route.commission,
    route.trade,
  ]) {
    if (!Number.isFinite(v) || v! < 0 || v! >= 100) {
      throw ShopError.invalid('费率须为0至100之间（不含100）')
    }
  }
  if (
    !['profit', 'profitRate', 'price'].includes(settings.mode) ||
    (settings.mode === 'price' && n.target! <= 0)
  ) {
    throw ShopError.invalid('计算模式或目标售价无效')
  }
  const freight = shipping(n.weight! * 1000, route.fees)
  const hidden = freight.seller.value
  const buyer = freight.buyer.value
  const rate = route.exchange
  const factor = (1 - n.withdraw! / 100) * (1 - n.loss! / 100)
  const indonesia = route.site === 'ID'
  const fee =
    (route.commission + n.activity! + (indonesia ? 0 : route.trade)) / 100
  const fixed = indonesia ? 3000 : (buyer * route.trade) / 100
  const denominator =
    1 - fee - (settings.mode === 'profitRate' ? n.target! / 100 / factor : 0)
  if (denominator <= 0) {
    throw ShopError.invalid('费率与目标利润率过高，无法计算有效售价')
  }
  const costs = (n.cost! + n.domestic!) * rate
  const targetSale =
    settings.mode === 'price'
      ? n.target!
      : ((costs + (settings.mode === 'profit' ? n.target! * rate : 0)) /
        factor +
        hidden +
        fixed) /
        denominator
  const discountFactor = 1 - n.discount! / 100
  let sale = targetSale
  let price = sale / discountFactor
  let coupon = 0
  if (route.coupons?.length) {
    const precision = route.precision ?? 2
    const roundUp = (value: number) => Number(display(value, precision))
    // Raising the price to cover one voucher may unlock a larger voucher.
    for (let attempt = 0; attempt <= route.coupons.length; attempt++) {
      const required = settings.mode === 'price' ? targetSale : targetSale + coupon
      price = roundUp(required / discountFactor)
      sale = roundUp(price * discountFactor)
      const eligible = route.coupons.reduce((largest, rule) =>
        sale >= rule.threshold ? Math.max(largest, rule.reduction) : largest, 0)
      if (coupon === eligible) {
        break
      }
      coupon = eligible
      if (settings.mode === 'price') {
        break
      }
    }
  }
  const paid = sale - coupon
  const commission = (paid * route.commission) / 100
  const trade = indonesia ? 3000 : ((paid + buyer) * route.trade) / 100
  const activity = (paid * n.activity!) / 100
  const revenue = paid - hidden - commission - trade - activity
  const withdraw = (revenue * n.withdraw!) / 100
  const loss = ((revenue - withdraw) * n.loss!) / 100
  const profit = (revenue - withdraw - loss - costs) / rate
  if (paid <= 0) {
    throw ShopError.invalid('优惠券抵扣全部售价，无法计算利润率')
  }
  const result = {
    price,
    sale,
    paid,
    coupon,
    profit,
    margin: ((profit * rate) / paid) * 100,
    hidden,
    buyer,
    commission,
    trade,
    activity,
    withdraw,
    loss,
    revenue,
    pricingExchange: rate / (1 - n.loss! / 100),
    sellerFormula: freight.seller.formula,
    buyerFormula: freight.buyer.formula,
  }
  if (
    Object.values(result).some(
      (v) => typeof v === 'number' && !Number.isFinite(v),
    )
  ) {
    throw ShopError.invalid('计算结果超出范围')
  }
  return result
}
export function paste(
  rows: Product[],
  r: number,
  c: number,
  text: string,
  defaults: Config['basic'],
) {
  const matrix = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => line.split('\t'))
  if (r + matrix.length > 1000) {
    throw ShopError.invalid('每表最多1000行')
  }
  for (const [i, line] of matrix.entries()) {
    while (rows.length <= r + i) {
      rows.push(newRow(defaults))
    }
    for (const [j, value] of line.entries()) {
      const col = inputs[c + j]
      if (col) {
        rows[r + i]![col[0]] = value
      }
    }
  }
}
export function display(value: number, precision = 2) {
  const p = 10 ** precision
  return (Math.ceil(value * p - 1e-7) / p).toFixed(precision)
}
// The upstream tree is normalized once at the service boundary; disabled paths inherit downwards.
export function routesFrom(
  sites: SiteData[],
  tree: ShippingSite[],
  rates: Record<string, number>,
  config: Config,
): Route[] {
  const routes: Route[] = []
  for (const site of sites) {
    const currency = String(
      site.currency_unit ||
      currencies.find((c) => c[2] === site.name)?.[0] ||
      site.name,
    )
    const exchange = rates[currency]
    if (!exchange) {
      continue
    }
    const cfg = config.sites[site.name]
    if (cfg?.enabled === false) {
      continue
    }
    for (const cargo of tree.find((s) => s.name === site.name)?.cargo_types ??
      []) {
      for (const channel of cargo.channels ?? []) {
        for (const zone of channel.zones ?? []) {
          const path = [
            String(cargo.name),
            String(channel.name),
            String(zone.name),
          ]
          if (
            path.some((_, i) =>
              cfg?.disabled.includes(JSON.stringify(path.slice(0, i + 1))),
            )
          ) {
            continue
          }
          routes.push({
            key: JSON.stringify([site.name, ...path]),
            site: site.name,
            siteName: site.cn_name,
            currency,
            cargo: cargo.cn_name,
            channel: channel.cn_name,
            region: zone.cn_name || zone.name,
            path,
            label: [
              site.cn_name,
              cargo.cn_name,
              channel.cn_name,
              zone.cn_name || zone.name,
            ].join(' / '),
            coupons: cfg?.coupons,
            precision: cfg?.precision ?? Number(config.basic.precision),
            fees: zone.fee_modes ?? [],
            exchange,
            commission: Number(site.platform_commission ?? 6),
            trade: Number(site.handling_fee ?? 2),
          })
        }
      }
    }
  }
  return routes.sort((a, b) => {
    const index = (s: string) => {
      const i = config.order.indexOf(s)
      return i < 0 ? 999 : i
    }
    return index(a.site) - index(b.site)
  })
}
export { parseCatalogContent, parseCollected, restoreCatalogMedia } from './catalog.js'

export * from './creative.js'

export * from './optimization.js'

export * from './workspace.js'
