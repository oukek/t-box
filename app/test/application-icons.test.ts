import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { validApplicationIcon } from '@t-box/app-contracts'
import { systemApplicationManifests } from '@t-box/shared'

const svg = (source: string) => `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`
test('each app owns a portable, valid icon matching its source SVG', () => {
  for (const manifest of systemApplicationManifests) {
    const app = manifest.id === 'profile' ? 'settings' : manifest.id
    const source = readFileSync(new URL(`../../apps/${app}/icon.svg`, import.meta.url))
    assert.equal(manifest.iconAsset, svg(source.toString()))
    assert.equal(validApplicationIcon(manifest.iconAsset), true, manifest.id)
  }
})
test('rejects unsafe, mislabeled and oversized images', () => {
  for (const source of [
    '<svg onload="alert(1)"></svg>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><foreignObject/></svg>',
    '<svg><image href="https://example.com/track"/></svg>',
    '<svg><path fill="url(https://example.com/x)"/></svg>',
    '<svg><!-- unsupported XML --></svg>',
  ]) {
    assert.equal(validApplicationIcon(svg(source)), false, source)
  }
  assert.equal(validApplicationIcon('https://example.com/icon.svg'), false)
  assert.equal(validApplicationIcon('data:image/png;base64,PHN2Zz48L3N2Zz4='), false)
  assert.equal(validApplicationIcon('data:image/png;base64,' + Buffer.alloc(128 * 1024 + 1).toString('base64')), false)
  assert.equal(validApplicationIcon('data:image/svg+xml;base64,invalid'), false)
})
test('accepts the supported raster formats without treating them as HTML', () => {
  for (const [mime, bytes] of [
    ['png', '\x89PNG\r\n\x1A\n'],
    ['jpeg', '\xFF\xD8\xFF'],
    ['gif', 'GIF89a'],
    ['webp', 'RIFFxxxxWEBP'],
  ]) {
    assert.equal(validApplicationIcon(`data:image/${mime};base64,${Buffer.from(bytes!, 'binary').toString('base64')}`), true)
  }
})
