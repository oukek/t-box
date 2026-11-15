import type { Route } from '@t-box/shop-tools-contracts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildRouteTree,
  routePrefix,
  selectedRouteKey,
} from '../src/routeTree.js'

function route(
  site: string,
  cargo: string,
  channel: string,
  region: string,
): Route {
  return {
    key: JSON.stringify([site, cargo, channel, region]),
    site,
    siteName: site,
    cargo,
    channel,
    region,
    path: [cargo, channel, region],
    label: [site, cargo, channel, region].join(' / '),
    currency: 'MYR',
    fees: [],
    exchange: 1,
    commission: 6,
    trade: 2,
  }
}
test('logistics parents merge by ID within each level without repeating complete paths', () => {
  const data = [
    route('MY', 'normal', 'standard', 'west'),
    route('MY', 'normal', 'standard', 'east'),
    route('MY', 'normal', 'express', 'west'),
    route('MY', 'sensitive', 'standard', 'west'),
    route('SG', 'normal', 'standard', 'all'),
  ]
  const tree = buildRouteTree([...data, data[0]!])
  assert.deepEqual(
    tree.map((n) => n.id),
    ['MY', 'SG'],
  )
  assert.deepEqual(
    tree[0]?.children.map((n) => n.id),
    ['normal', 'sensitive'],
  )
  assert.deepEqual(
    tree[0]?.children[0]?.children.map((n) => n.id),
    ['standard', 'express'],
  )
  assert.deepEqual(
    tree[0]?.children[0]?.children[0]?.children.map((n) => n.id),
    ['west', 'east'],
  )
  assert.equal(
    selectedRouteKey(tree, ['MY', 'normal', 'standard', 'east']),
    data[1]?.key,
  )
  assert.equal(
    selectedRouteKey(tree, ['SG', 'normal', 'standard', 'all']),
    data[4]?.key,
  )
})
test('invalid or incomplete cascades cannot resolve a logistics scheme', () => {
  const tree = buildRouteTree([
    route('MY', 'normal', 'standard', 'west'),
    route('SG', 'sensitive', 'express', 'all'),
  ])
  assert.equal(selectedRouteKey(tree, ['MY', 'normal', 'standard']), undefined)
  assert.equal(
    selectedRouteKey(tree, ['SG', 'normal', 'standard', 'west']),
    undefined,
  )
  assert.deepEqual(routePrefix(tree, ['SG', 'normal', 'standard', 'west']), [
    'SG',
  ])
  assert.deepEqual(routePrefix(tree, ['MY', 'normal', 'missing', 'west']), [
    'MY',
    'normal',
  ])
})
test('identical display labels never merge distinct cargo or channel IDs', () => {
  const first = {
    ...route('MY', 'cargo-a', 'channel-a', 'all'),
    cargo: '普货',
    channel: '标准',
  }
  const second = {
    ...route('MY', 'cargo-b', 'channel-b', 'all'),
    cargo: '普货',
    channel: '标准',
  }
  const tree = buildRouteTree([first, second])
  assert.equal(tree[0]?.children.length, 2)
  assert.equal(
    selectedRouteKey(tree, ['MY', 'cargo-b', 'channel-b', 'all']),
    second.key,
  )
})
