import type { Product, Session } from './types'

export const emptySession = (): Session => ({
  products: [],
  lastImport: null,
})
export function upsertProduct(session: Session, product: Product): Session {
  const products = [
    product,
    ...session.products.filter((p) => p.id !== product.id),
  ]
  if (products.length > 200) {
    throw new Error('临时预览最多保留 200 件，请先导出并移除部分商品')
  }
  const next = { ...session, products }
  if (new TextEncoder().encode(JSON.stringify(next)).length > 7_000_000) {
    throw new Error('临时预览空间不足，请先导出并移除部分商品')
  }
  return next
}
export function exportProducts(products: Product[]): string {
  return JSON.stringify(
    {
      schema: 'tark.collector.products',
      version: 1,
      exportedAt: new Date().toISOString(),
      media: 'source-links-only',
      products,
    },
    null,
    2,
  )
}

export function mergeProducts(session: Session, products: Product[]) {
  let next = session
  let added = 0
  let updated = 0
  const unique = new Map(products.map((product) => [product.id, product]))
  for (const product of unique.values()) {
    if (next.products.some((entry) => entry.id === product.id)) {
      updated++
    } else {
      added++
    }
    next = upsertProduct(next, product)
  }
  return { session: next, added, updated }
}
