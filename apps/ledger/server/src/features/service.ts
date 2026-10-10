import type { FinanceService } from "../finance/service.js";
import { AccountService } from "./accounts.js";
import { CategoryManagement } from "./categories.js";
import { RecordService } from "./records.js";
import { RefundService } from "./refunds.js";
import { PlanningService } from "./planning.js";
import { ContactService } from "./contacts.js";
import { BatchService } from "./batch.js";
import { ImportExportService } from "./import-export.js";
import { AttachmentService } from "./attachments.js";
export class LedgerFeatures {
  readonly accounts;
  readonly categories;
  readonly records;
  readonly refunds;
  readonly planning;
  readonly contacts;
  readonly batch;
  readonly imports;
  readonly attachments;
  constructor(finance: FinanceService) {
    this.accounts = new AccountService(finance);
    this.categories = new CategoryManagement(finance);
    this.records = new RecordService(finance);
    this.refunds = new RefundService(finance);
    this.planning = new PlanningService(finance);
    this.contacts = new ContactService(finance);
    this.batch = new BatchService(finance, this);
    this.imports = new ImportExportService(finance, this);
    this.attachments = new AttachmentService(finance);
  }
}
