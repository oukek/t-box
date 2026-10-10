import type { LedgerAttachmentInput } from "./attachments.js";
export type BillType = "income" | "expense";
export type CategoryId = string;
export interface BillCategory {
  id: CategoryId;
  label: string;
  type: BillType;
  icon: string;
  iconId?: string | null;
  isDefault: boolean;
  active?: boolean;
  sortOrder?: number;
  pinned?: boolean;
}
export interface CategoryInput {
  label: string;
  type: BillType;
  icon?: string;
  iconId?: string | null;
}

/** Monetary values cross the API boundary as decimal strings, never floats. */
export interface BillInput extends LedgerAttachmentInput {
  type: BillType;
  amount: string;
  category: CategoryId;
  date: string;
  note: string;
  accountId?: string | null;
}

export interface Bill extends BillInput {
  id: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillSummary {
  income: string;
  expense: string;
  balance: string;
  count: number;
  categories: { category: CategoryId; amount: string }[];
}

export interface BillListResponse {
  data: Bill[];
  meta: { page: number; pageSize: number; total: number };
}
