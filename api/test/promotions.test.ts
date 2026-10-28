import assert from 'node:assert/strict'
import test from 'node:test'
import jsQR from 'jsqr'
import sharp from 'sharp'
import { PromotionPoster } from '../src/promotions/poster.js'
import { validPromotionToken } from '../src/promotions/service.js'

const decodeQr = jsQR as unknown as (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null

test('poster QR decodes to the complete source URL, with no raw user identifier', async () => {
  const posters = new PromotionPoster()
  const link = 'https://tboxos.cn/?ref=0123456789abcdef0123456789abcdef'
  const [first, second] = await Promise.all([posters.render(link), posters.render(link)])
  assert.equal(first, second, 'Concurrent requests share the rendered image')
  const { data, info } = await sharp(first).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 1080)
  assert.equal(info.height, 1920)
  const code = decodeQr(new Uint8ClampedArray(data), info.width, info.height)
  assert.equal(code?.data, link)
  const other = 'https://tboxos.cn/?ref=abcdef0123456789abcdef0123456789'
  const alternate = await sharp(await posters.render(other)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(decodeQr(new Uint8ClampedArray(alternate.data), alternate.info.width, alternate.info.height)?.data, other)
  const thumbnail = await sharp(await posters.thumbnail()).metadata()
  assert.equal(thumbnail.width, 300)
  assert.equal(thumbnail.height, 300)
})

test('public promotion codes accept only opaque fixed-length hexadecimal values', () => {
  assert.equal(validPromotionToken('0123456789abcdef0123456789abcdef'), true)
  for (const value of [null, {}, 'user-id', 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32), '../poster.png']) {
    assert.equal(validPromotionToken(value), false)
  }
})
