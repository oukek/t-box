import type { LedgerAttachmentInput } from "./attachments.js";
export type LedgerRole = "owner" | "admin" | "editor" | "viewer";
export type LedgerTemplate = "daily" | "debt" | "combined";
export type StatisticPeriod = "day" | "month" | "quarter" | "year";
export type DebtDirection = "receivable" | "payable";
export interface Ledger {
  id: string;
  name: string;
  template: LedgerTemplate;
  currency: "CNY";
  ownerId: string | null;
  role: LedgerRole;
  archived: boolean;
  hasPassword: boolean;
  locked: boolean;
  authorizationScope?: "read" | "write" | null;
  revision: number;
  memberCount: number;
}
export interface LedgerInput {
  name: string;
  template: LedgerTemplate;
  password?: string;
}
export interface LedgerMember {
  userId: string;
  username: string;
  nickname: string;
  role: LedgerRole;
  joinedAt: string;
}
export interface LedgerInvite {
  id: string;
  role: Exclude<LedgerRole, "owner">;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revoked: boolean;
}
export interface LedgerCashEntry {
  id: string;
  kind:
    | "income"
    | "expense"
    | "lend"
    | "borrow"
    | "collect"
    | "repay"
    | "correction"
    | "refund"
    | "transfer"
    | "writeoff"
    | "reimbursement";
  date: string;
  inflow: string;
  outflow: string;
  note: string;
  createdBy: string | null;
}
export interface DebtInput extends LedgerAttachmentInput {
  direction: DebtDirection;
  counterparty: string;
  amount: string;
  date: string;
  dueDate: string | null;
  note: string;
  cashMovement: boolean;
  accountId?: string | null;
  contactId?: string | null;
}
export interface Debt extends DebtInput {
  id: string;
  ledgerId: string;
  settled: string;
  adjusted?: string;
  remaining: string;
  status: "open" | "settled";
  createdBy: string;
  createdAt: string;
}
export interface SettlementInput extends LedgerAttachmentInput {
  date: string;
  note: string;
  accountId?: string | null;
  allocations: { debtId: string; amount: string }[];
}
export interface Settlement {
  id: string;
  direction: DebtDirection;
  counterparty: string;
  amount: string;
  date: string;
  note: string;
  createdBy: string;
  reversed: boolean;
  allocations: { debtId: string; amount: string }[];
}
export interface LedgerStatisticPoint {
  date: string;
  income: string;
  expense: string;
  cashIn: string;
  cashOut: string;
  receivableChange: string;
  payableChange: string;
  count: number;
}
export interface LedgerStatistics {
  grossExpense?: string;
  refunded?: string;
  reimbursed?: string;
  period: StatisticPeriod;
  value: string;
  start: string;
  end: string;
  revision: number;
  income: string;
  expense: string;
  balance: string;
  cashIn: string;
  cashOut: string;
  cashNet: string;
  count: number;
  openingReceivable: string;
  openingPayable: string;
  closingReceivable: string;
  closingPayable: string;
  currentReceivable: string;
  currentPayable: string;
  categories: {
    category: string;
    type: "income" | "expense";
    amount: string;
    count: number;
  }[];
  series: LedgerStatisticPoint[];
}
