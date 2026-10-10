import type { DataSource } from "typeorm";
import type { AiFeeSchedule } from "@t-box/shared";
import { prices } from "./money.js";
import type { ConfigurationCache } from "../configuration/cache.js";
/** Public rates only: no SDK instantiation, credential decryption or model identifiers. */
export class BillingPricingService {
  constructor(
    private readonly source: DataSource,
    private readonly cache?: ConfigurationCache,
  ) {}
  async schedule(): Promise<AiFeeSchedule> {
    if (this.cache)
      return this.cache.current(
        this.source,
        "public-pricing",
        () => this.load(),
        true,
      );
    return this.load();
  }
  private async load(): Promise<AiFeeSchedule> {
    const rows: {
      purpose: string;
      inputPrice: string;
      outputPrice: string;
      imagePrice: string;
    }[] = await this.source.query(`
      SELECT m.purpose,m.input_price AS inputPrice,m.output_price AS outputPrice,m.image_price AS imagePrice
      FROM ai_settings s JOIN ai_models m ON (m.id=s.model_id AND m.purpose='conversation') OR (m.id=s.image_model_id AND m.purpose='image')
      JOIN ai_providers p ON p.id=m.provider_id WHERE s.id=1 AND m.enabled=1 AND p.enabled=1`);
    const conversation = rows.find((r) => r.purpose === "conversation"),
      image = rows.find((r) => r.purpose === "image");
    return {
      currency: "CNY",
      tokenUnit: 1_000_000,
      titleFree: true,
      conversation: conversation
        ? {
            inputPrice: prices(conversation).inputPrice,
            outputPrice: prices(conversation).outputPrice,
          }
        : null,
      image: image ? { imagePrice: prices(image).imagePrice } : null,
    };
  }
}
