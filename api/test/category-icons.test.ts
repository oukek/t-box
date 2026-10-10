import assert from 'node:assert/strict'
import test from 'node:test'
import { categoryIconBytes } from '@t-box/ledger-server/categories/icons'

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQZYAAAAASUVORK5CYII='
test('category thumbnails accept bounded PNG data and reject active content, invalid encodings and oversized dimensions', () => {
  assert.equal(categoryIconBytes(png).toString('base64'), png)
  for (const value of [
    null,
    '',
    '%%%=',
    Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),
    Buffer.alloc(65536).toString('base64'),
    Buffer.alloc(65537).toString('base64'),
  ]) {
    assert.throws(() => categoryIconBytes(value))
  }
  for (const [width, height] of [
    [0, 96],
    [96, 0],
    [129, 96],
    [96, 129],
    [100000, 100000],
  ]) {
    const bytes = Buffer.from(png, 'base64')
    bytes.writeUInt32BE(width!, 16)
    bytes.writeUInt32BE(height!, 20)
    assert.throws(() => categoryIconBytes(bytes.toString('base64')))
  }
})
