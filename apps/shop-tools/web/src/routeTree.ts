import type { Route } from '@t-box/shop-tools-contracts'

export interface RouteNode {
  id: string
  label: string
  children: RouteNode[]
  routeKey?: string
}
export const routeLevels = ['站点', '货物类型', '渠道', '地区'] as const
export function buildRouteTree(routes: readonly Route[]): RouteNode[] {
  const roots: RouteNode[] = []
  for (const route of routes) {
    if (route.path.length !== 3) {
      continue
    }
    const ids = [route.site, ...route.path]
    const labels = [route.siteName, route.cargo, route.channel, route.region]
    let siblings = roots
    for (let level = 0; level < 4; level++) {
      const id = ids[level]!
      const label = labels[level]!
      let node = siblings.find((node) => node.id === id)
      if (!node) {
        node = { id, label, children: [] }
        siblings.push(node)
      }
      if (level === 3) {
        node.routeKey ??= route.key
      }
      siblings = node.children
    }
  }
  return roots
}
export function routePrefix(
  tree: readonly RouteNode[],
  path: readonly string[],
): string[] {
  const valid: string[] = []
  let siblings = tree
  for (const id of path) {
    const node = siblings.find((node) => node.id === id)
    if (!node) {
      break
    }
    valid.push(id)
    siblings = node.children
  }
  return valid
}
export function selectedRouteKey(
  tree: readonly RouteNode[],
  path: readonly string[],
): string | undefined {
  if (path.length !== 4) {
    return undefined
  }
  let siblings = tree
  let node: RouteNode | undefined
  for (const id of path) {
    node = siblings.find((node) => node.id === id)
    if (!node) {
      return undefined
    }
    siblings = node.children
  }
  return node?.routeKey
}
