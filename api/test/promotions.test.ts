import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultPromotionCreative } from '@t-box/shared'
import jsQR from 'jsqr'
import sharp from 'sharp'
import { normalizePromotionImage, parsePromotionCreative, promotionQrPlacement } from '../src/promotions/creatives.js'
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

test('uploaded share images are safe 300px JPEGs and undersized or invalid invitation images are rejected', async () => {
  const bytes = await sharp({ create: { width: 900, height: 600, channels: 4, background: '#43a09088' } }).png().toBuffer()
  const image = await normalizePromotionImage(bytes, 'thumbnail')
  assert.equal(image.info.width, 300)
  assert.equal(image.info.height, 300)
  assert.equal(image.info.format, 'jpeg')
  const small = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#123456' } }).png().toBuffer()
  await assert.rejects(normalizePromotionImage(small, 'poster'), /600/)
  await assert.rejects(normalizePromotionImage(Buffer.from('<svg><script>alert(1)</script></svg>'), 'thumbnail'), /静态图片/)
})

test('QR placement retains the original layout and prevents cropped or unscannably small codes', () => {
  const settings = defaultPromotionCreative()
  assert.deepEqual(promotionQrPlacement(1080, 1920, settings.qr), { left: 760, top: 1625, width: 232 })
  assert.throws(() => promotionQrPlacement(900, 1200, { x: 70, y: 95, size: 20 }), /完整位于/)
  assert.throws(() => promotionQrPlacement(600, 900, { x: 70, y: 80, size: 5 }), /128/)
  assert.throws(() => parsePromotionCreative({ ...settings, qr: { x: 90, y: 80, size: 20 } }))
  assert.throws(() => parsePromotionCreative({ ...settings, title: ' ' }))
})
