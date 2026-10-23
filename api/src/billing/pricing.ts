import type { QuotaCatalog } from './quota/catalog.js'
/** Public tariff never includes model IDs, supplier rates or credentials. */
export class BillingPricingService {
  constructor(private readonly catalog: QuotaCatalog) {}
  schedule() {
    return this.catalog.tariff()
  }
}
