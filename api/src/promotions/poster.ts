import { readFile } from 'node:fs/promises'
import QRCode from 'qrcode'
import sharp from 'sharp'

// This path resolves to api/assets in both src/ and the deployed dist/ layout.
const template = new URL('../../assets/promotion-poster.jpg', import.meta.url)
const thumbnail = new URL('../../assets/promotion-thumbnail.jpg', import.meta.url)
export const promotionQrArea = { left: 760, top: 1625, width: 232, height: 232 }

export class PromotionPoster {
  private readonly cache = new Map<string, Promise<Buffer>>()

  async render(link: string) {
    const cached = this.cache.get(link)
    if (cached) {
      return cached
    }
    const pending = (async () => {
      const qr = await QRCode.toBuffer(link, { width: promotionQrArea.width, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#082b26', light: '#ffffff' } })
      return sharp(await readFile(template)).composite([{ input: qr, left: promotionQrArea.left, top: promotionQrArea.top }]).png().toBuffer()
    })()
    this.cache.set(link, pending)
    if (this.cache.size > 12) {
      this.cache.delete(this.cache.keys().next().value!)
    }
    try {
      return await pending
    } catch (cause) {
      this.cache.delete(link)
      throw cause
    }
  }

  thumbnail() {
    return readFile(thumbnail)
  }
}
