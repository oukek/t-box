import type { LedgerAccess } from "../ledgers/access.js";
import type { FinanceService } from "../finance/service.js";
import type { StatisticsService } from "../statistics/service.js";

/** Only the ledger's domain services enter its application adapter. */
export interface LedgerServices {
  access: LedgerAccess;
  finance: FinanceService;
  statistics: StatisticsService;
}
