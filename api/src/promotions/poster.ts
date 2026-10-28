import type { PromotionCreativeSettings } from '@t-box/shared'
import type { PromotionCreativeService } from './creatives.js'
import { readFile } from 'node:fs/promises'
import { defaultPromotionCreative } from '@t-box/shared'
import QRCode from 'qrcode'
import sharp from 'sharp'
import { promotionQrPlacement } from './creatives.js'

// This path resolves to api/assets in both src/ and the deployed dist/ layout.
const template = new URL('../../assets/promotion-poster.jpg', import.meta.url)
const thumbnail = new URL('../../assets/promotion-thumbnail.jpg', import.meta.url)
export const promotionQrArea = { left: 760, top: 1625, width: 232, height: 232 }

export class PromotionPoster {
  private readonly cache = new Map<string, Promise<Buffer>>()

  constructor(private readonly creatives?: PromotionCreativeService) {}

  async render(link: string, settings?: PromotionCreativeSettings) {
    const creative = settings ?? (this.creatives ? await this.creatives.read() : { ...defaultPromotionCreative(), thumbnail: null, poster: null })
    const key = JSON.stringify([link, creative.revision, creative.posterId, creative.qr])
    const cached = this.cache.get(key)
    if (cached) {
      return cached
    }
    const pending = (async () => {
      const templateBytes = creative.posterId && this.creatives ? await this.creatives.bytes(creative.posterId) : await readFile(template)
      const image = sharp(templateBytes)
      const meta = await image.metadata()
      const placement = promotionQrPlacement(meta.width!, meta.height!, creative.qr)
      const qr = await QRCode.toBuffer(link, { width: placement.width, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#082b26', light: '#ffffff' } })
      return image.composite([{ input: qr, left: placement.left, top: placement.top }]).png().toBuffer()
    })()
    this.cache.set(key, pending)
    if (this.cache.size > 12) {
      this.cache.delete(this.cache.keys().next().value!)
    }
    try {
      return await pending
    } catch (cause) {
      this.cache.delete(key)
      throw cause
    }
  }

  async thumbnail() {
    const creative = await this.creatives?.read()
    return creative?.thumbnailId ? this.creatives!.bytes(creative.thumbnailId) : readFile(thumbnail)
  }

  defaultTemplate() {
    return readFile(template)
  }

  defaultThumbnail() {
    return readFile(thumbnail)
  }
}
