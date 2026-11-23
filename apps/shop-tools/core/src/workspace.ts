import { parseTemplates } from './creative.js'
import type {
  Config,
  Coupon,
  Product,
  WorkspaceMetadata,
  WorkspacePatch,
  WorkspaceState,
} from '@t-box/shop-tools-contracts'
import { inputs, outputs, ShopError } from '@t-box/shop-tools-contracts'
import { clone, validateBook } from './index.js'

const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength
const key = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-z0-9_-]{1,80}$/.test(s)
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ShopError.invalid('工作区数据格式无效')
  }
  return value as Record<string, unknown>
}
export function validateCoupons(value: unknown): Coupon[] {
  if (!Array.isArray(value)) throw ShopError.invalid('优惠券列表格式无效')
  return value.map((entry) => {
    const { threshold, reduction } = object(entry)
    if (typeof threshold !== 'number' || typeof reduction !== 'number' ||
      !Number.isFinite(threshold) || !Number.isFinite(reduction) ||
      threshold <= 0 || reduction <= 0 || reduction > threshold) {
      throw ShopError.invalid('门槛和减免金额须大于零，减免不能超过门槛')
    }
    return { threshold, reduction }
  })
}
export function validateProduct(value: unknown): Product {
  const r = object(value)
  if (
    !key(r.id) ||
    inputs.some(
      ([k]) =>
        !['number', 'string'].includes(typeof r[k]) ||
        String(r[k]).length > 2000 ||
        (typeof r[k] === 'number' && !Number.isFinite(r[k])),
    )
  ) {
    throw ShopError.invalid('商品输入格式无效')
  }
  return {
    id: r.id,
    ...Object.fromEntries(inputs.map(([k]) => [k, r[k]])),
  } as Product
}
export function validateMetadata(value: unknown): WorkspaceMetadata {
  const m = object(value)
  if (
    !Array.isArray(m.sheets) ||
    !m.sheets.length ||
    m.sheets.length > 20 ||
    !key(m.activeSheetId)
  ) {
    throw ShopError.invalid('工作表格式无效')
  }
  const b = validateBook({
    version: 1,
    activeSheetId: m.activeSheetId,
    sheets: m.sheets.map((s) => ({ ...object(s), rows: [] })),
  })
  if (
    b.sheets.some(
      (s) =>
        !key(s.id) ||
        typeof s.settings.routeKey !== 'string' ||
        s.settings.routeKey.length > 2000 ||
        Number.isNaN(Date.parse(s.settings.date)) ||
        new Date(s.settings.date).toISOString().slice(0, 10) !==
          s.settings.date,
    ) ||
    !b.sheets.some((s) => s.id === m.activeSheetId)
  ) {
    throw ShopError.invalid('工作表设置格式无效')
  }
  return {
    activeSheetId: m.activeSheetId,
    sheets: b.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      settings: {
        mode: s.settings.mode,
        date: s.settings.date,
        routeKey: s.settings.routeKey,
      },
    })),
  }
}
export function validateConfig(value: unknown): Config {
  const c = object(value)
  const basic = object(c.basic)
  const sites = object(c.sites)
  if (bytes(c) > 100000) {
    throw ShopError.invalid('配置数据过大')
  }
  const keys = [
    'weight',
    'domestic',
    'activity',
    'withdraw',
    'discount',
    'loss',
    'precision',
  ]
  if (
    keys.some(
      (k) =>
        !['string', 'number'].includes(typeof basic[k]) ||
        String(basic[k]).length > 80,
    ) ||
    !Array.isArray(c.order) ||
    c.order.length > 100 ||
    c.order.some((v) => typeof v !== 'string' || v.length > 20) ||
    new Set(c.order).size !== c.order.length ||
      Object.keys(sites).length > 100
  ) {
    throw ShopError.invalid('配置格式无效')
  }
  for (const k of keys) {
    const v = basic[k]
    const n = Number(v)
    if (k === 'weight' || k === 'domestic') {
      if (
        v !== '' &&
        (!Number.isFinite(n) || n < 0 || (k === 'weight' && n === 0))
      ) {
        throw ShopError.invalid('重量须大于0，运费不能为负数')
      }
    } else if (
      String(v).trim() === '' ||
      !Number.isFinite(n) ||
      (k === 'precision'
        ? !Number.isInteger(n) || n < 0 || n > 6
        : n < 0 || n >= 100)
    ) {
      throw ShopError.invalid('默认费率或精度无效')
    }
  }
  const normalized: Config['sites'] = {}
  for (const [id, value] of Object.entries(sites)) {
    const s = object(value)
    if (
      !/^[A-Z]{2,8}$/.test(id) ||
      typeof s.enabled !== 'boolean' ||
      !Array.isArray(s.disabled) ||
      s.disabled.length > 1000 ||
      s.disabled.some((v) => typeof v !== 'string' || v.length > 2000) ||
      (s.precision !== undefined &&
        (!Number.isInteger(s.precision) ||
          Number(s.precision) < 0 ||
          Number(s.precision) > 6))
    ) {
      throw ShopError.invalid('站点配置格式无效')
    }
    normalized[id] = {
      enabled: s.enabled,
      disabled: s.disabled as string[],
      ...(s.coupons === undefined ? {} : { coupons: validateCoupons(s.coupons) }),
      ...(s.precision === undefined ? {} : { precision: Number(s.precision) }),
    }
  }
  return {
    basic: Object.fromEntries(
      keys.map((k) => [k, basic[k]]),
    ) as Config['basic'],
    order: c.order as string[],
    sites: normalized,
    ...(c.creativeTemplates === undefined ? {} : { creativeTemplates: parseTemplates(c.creativeTemplates) }),
  }
}
function historyRoute(value: unknown) {
  const r = object(value)
  for (const k of [
    'key',
    'site',
    'siteName',
    'currency',
    'cargo',
    'channel',
    'region',
    'label',
  ]) {
    if ((k === 'coupon' || k === 'paid') && r[k] === undefined) continue
    if (typeof r[k] !== 'string' || r[k].length > 2000) {
      throw ShopError.invalid('结果记录物流信息无效')
    }
  }
  for (const k of ['exchange', 'commission', 'trade']) {
    if (
      typeof r[k] !== 'number' ||
      !Number.isFinite(r[k]) ||
      (k === 'exchange' ? r[k] <= 0 : r[k] < 0 || r[k] >= 100)
    ) {
      throw ShopError.invalid('结果记录汇率或费率无效')
    }
  }
  if (
    !Array.isArray(r.path) ||
    r.path.length !== 3 ||
    r.path.some((v) => typeof v !== 'string' || v.length > 2000) ||
    !Array.isArray(r.fees) ||
    r.fees.length > 1000
  ) {
    throw ShopError.invalid('结果记录物流规则无效')
  }
  for (const value of r.fees) {
    const fee = object(value)
    if (
      !['Seller', 'Buyer'].includes(String(fee.type)) ||
      !['Flat', 'WeightRange', 'Increment'].includes(String(fee.name))
    ) {
      throw ShopError.invalid('结果记录物流规则无效')
    }
  }
}
function historyResult(value: unknown) {
  const r = object(value)
  for (const k of [
    ...outputs.map(([key]) => key),
    'revenue',
    'pricingExchange',
  ]) {
    if ((k === 'coupon' || k === 'paid') && r[k] === undefined) continue
    if (typeof r[k] !== 'number' || !Number.isFinite(r[k])) {
      throw ShopError.invalid('结果记录金额无效')
    }
  }
  for (const k of ['sellerFormula', 'buyerFormula']) {
    if ((k === 'coupon' || k === 'paid') && r[k] === undefined) continue
    if (typeof r[k] !== 'string' || r[k].length > 10000) {
      throw ShopError.invalid('结果记录公式无效')
    }
  }
}
export function validatePatch(value: unknown): WorkspacePatch {
  const v = object(value)
  if (
    Object.keys(v).some(
      (k) =>
        ![
          'revision',
          'metadata',
          'config',
          'history',
          'upserts',
          'removals',
        ].includes(k),
    ) ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 0 ||
    !Array.isArray(v.upserts) ||
    v.upserts.length > 100 ||
    !Array.isArray(v.removals) ||
    v.removals.length > 200 ||
    bytes(v) > 700000
  ) {
    throw ShopError.invalid('保存数据过大或格式无效')
  }
  const result: WorkspacePatch = {
    revision: Number(v.revision),
    upserts: v.upserts.map((value) => {
      const r = object(value)
      if (
        !key(r.sheetId) ||
        !Number.isInteger(r.position) ||
        Number(r.position) < 0 ||
        Number(r.position) > 999
      ) {
        throw ShopError.invalid('商品位置无效')
      }
      return {
        sheetId: r.sheetId,
        position: Number(r.position),
        row: validateProduct(r.row),
      }
    }),
    removals: v.removals.map((value) => {
      const r = object(value)
      if (!key(r.sheetId) || !key(r.id)) {
        throw ShopError.invalid('商品标识无效')
      }
      return { sheetId: r.sheetId, id: r.id }
    }),
  }
  const identifiers = new Set<string>()
  for (const r of [
    ...result.upserts.map((r) => ({ sheetId: r.sheetId, id: r.row.id })),
    ...result.removals,
  ]) {
    const id = JSON.stringify([r.sheetId, r.id])
    if (identifiers.has(id)) {
      throw ShopError.invalid('保存操作重复')
    }
    identifiers.add(id)
  }
  if (v.metadata !== undefined) {
    result.metadata = validateMetadata(v.metadata)
  }
  if (v.config !== undefined) {
    result.config = validateConfig(v.config)
  }
  if (v.history !== undefined) {
    const h = object(v.history)
    if (
      !Object.hasOwn(h, 'detail') ||
      !Object.hasOwn(h, 'comparison') ||
      bytes(h) > 500000
    ) {
      throw ShopError.invalid('结果记录格式无效')
    }
    for (const [k, t] of [
      ['detail', 'time'],
      ['comparison', 'createdAt'],
    ] as const) {
      if (h[k] !== null) {
        const r = object(h[k])
        validateProduct(r.row)
        if (typeof r[t] !== 'string' || !Number.isFinite(Date.parse(r[t]))) {
          throw ShopError.invalid('结果记录时间无效')
        }
        if (k === 'detail') {
          historyRoute(r.route)
          historyResult(r.result)
        } else {
          if (!Array.isArray(r.entries) || r.entries.length > 1000) {
            throw ShopError.invalid('比较结果格式无效')
          }
          validateMetadata({
            activeSheetId: 'history',
            sheets: [{ id: 'history', name: '结果记录', settings: r.settings }],
          })
          for (const value of r.entries) {
            const entry = object(value)
            historyRoute(entry.route)
            if (entry.result !== null) {
              historyResult(entry.result)
            }
            if (typeof entry.error !== 'string' || entry.error.length > 2000) {
              throw ShopError.invalid('比较结果状态无效')
            }
          }
        }
      }
    }
    result.history = clone(h) as unknown as WorkspacePatch['history']
  }
  return result
}
export function metadataOf(state: WorkspaceState): WorkspaceMetadata {
  return {
    activeSheetId: state.book.activeSheetId,
    sheets: state.book.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      settings: clone(s.settings),
    })),
  }
}
export function diffWorkspace(
  before: WorkspaceState | null,
  after: WorkspaceState,
): Omit<WorkspacePatch, 'revision'>[] {
  const metadata = metadataOf(after)
  const prev = before ? metadataOf(before) : null
  const base: Omit<WorkspacePatch, 'revision'> = { upserts: [], removals: [] }
  if (JSON.stringify(metadata) !== JSON.stringify(prev)) {
    base.metadata = metadata
  }
  if (JSON.stringify(before?.config) !== JSON.stringify(after.config)) {
    base.config = clone(after.config)
  }
  const history = { detail: after.detail, comparison: after.comparison }
  if (
    JSON.stringify(
      before ? { detail: before.detail, comparison: before.comparison } : null,
    ) !== JSON.stringify(history)
  ) {
    base.history = clone(history)
  }
  const operations: {
    upsert?: WorkspacePatch['upserts'][number]
    remove?: WorkspacePatch['removals'][number]
  }[] = []
  for (const s of after.book.sheets) {
    const old = before?.book.sheets.find((b) => b.id === s.id)
    const prevRows = new Map(
      old?.rows.map((r, i) => [r.id, { row: r, position: i }]) ?? [],
    )
    const ids = new Set(s.rows.map((r) => r.id))
    for (const r of old?.rows ?? []) {
      if (!ids.has(r.id)) {
        operations.push({ remove: { sheetId: s.id, id: r.id } })
      }
    }
    for (const [position, row] of s.rows.entries()) {
      const prev = prevRows.get(row.id)
      if (
        !prev ||
        prev.position !== position ||
        JSON.stringify(prev.row) !== JSON.stringify(row)
      ) {
        operations.push({
          upsert: { sheetId: s.id, position, row: clone(row) },
        })
      }
    }
  }
  const patches: Omit<WorkspacePatch, 'revision'>[] = []
  let batch = base
  if (bytes(batch) > 650000 && batch.history) {
    const history = batch.history
    delete batch.history
    patches.push(batch)
    batch = { upserts: [], removals: [], history }
  }
  for (const op of operations) {
    const next = clone(batch)
    if (op.upsert) {
      next.upserts.push(op.upsert)
    }
    if (op.remove) {
      next.removals.push(op.remove)
    }
    if (
      next.upserts.length + next.removals.length > 50 ||
      bytes(next) > 650000
    ) {
      if (
        batch.upserts.length ||
        batch.removals.length ||
        batch.metadata ||
        batch.config ||
        batch.history
      ) {
        patches.push(batch)
      }
      batch = {
        upserts: op.upsert ? [op.upsert] : [],
        removals: op.remove ? [op.remove] : [],
      }
    } else {
      batch = next
    }
  }
  if (
    batch.upserts.length ||
    batch.removals.length ||
    batch.metadata ||
    batch.config ||
    batch.history
  ) {
    patches.push(batch)
  }
  return patches
}
