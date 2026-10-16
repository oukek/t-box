import type { AiFeeSchedule } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { ConfigurationCache } from '../configuration/cache.js'
import { prices } from './money.js'
/** Public rates only: no SDK instantiation, credential decryption or model identifiers. */
export class BillingPricingService {
  constructor(
    private readonly source: DataSource,
    private readonly cache?: ConfigurationCache,
  ) {}

  async schedule(): Promise<AiFeeSchedule> {
    if (this.cache) {
      return this.cache.current(
        this.source,
        'public-pricing',
        () => this.load(),
        true,
      )
    }
    return this.load()
  }

  private async load(): Promise<AiFeeSchedule> {
    const rows: {
      purpose: string
      inputPrice: string
      outputPrice: string
      imagePrice: string
      minInputPrice: string
      minOutputPrice: string
      minImagePrice: string
    }[] = await this.source.query(`
      SELECT m.purpose,MAX(m.input_price) AS inputPrice,MAX(m.output_price) AS outputPrice,MAX(m.image_price) AS imagePrice,
        MIN(m.input_price) AS minInputPrice,MIN(m.output_price) AS minOutputPrice,MIN(m.image_price) AS minImagePrice
      FROM ai_settings s JOIN ai_models m ON
        (m.purpose='conversation' AND (m.id=s.model_id OR (EXISTS(SELECT 1 FROM ai_model_pool a WHERE a.purpose='conversation' AND a.model_id=s.model_id)
          AND EXISTS(SELECT 1 FROM ai_model_pool b WHERE b.purpose='conversation' AND b.model_id=m.id)))) OR
        (m.purpose='image' AND (m.id=s.image_model_id OR (EXISTS(SELECT 1 FROM ai_model_pool a WHERE a.purpose='image' AND a.model_id=s.image_model_id)
          AND EXISTS(SELECT 1 FROM ai_model_pool b WHERE b.purpose='image' AND b.model_id=m.id))))
      JOIN ai_providers p ON p.id=m.provider_id WHERE s.id=1 AND m.enabled=1 AND p.enabled=1 GROUP BY m.purpose`)
    const conversation = rows.find((r) => r.purpose === 'conversation')
    const image = rows.find((r) => r.purpose === 'image')
    return {
      currency: 'CNY',
      tokenUnit: 1_000_000,
      titleFree: true,
      conversation: conversation
        ? {
            inputPrice: prices(conversation).inputPrice,
            outputPrice: prices(conversation).outputPrice,
            ...(conversation.minInputPrice != null && conversation.minInputPrice !== conversation.inputPrice ? { minInputPrice: prices({ inputPrice: conversation.minInputPrice }).inputPrice } : {}),
            ...(conversation.minOutputPrice != null && conversation.minOutputPrice !== conversation.outputPrice ? { minOutputPrice: prices({ outputPrice: conversation.minOutputPrice }).outputPrice } : {}),
          }
        : null,
      image: image ? { imagePrice: prices(image).imagePrice, ...(image.minImagePrice != null && image.minImagePrice !== image.imagePrice ? { minImagePrice: prices({ imagePrice: image.minImagePrice }).imagePrice } : {}) } : null,
    }
  }
}
