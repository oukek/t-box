import type {
  Ledger,
  LedgerInput,
  LedgerStatistics,
  StatisticPeriod,
  Debt,
  DebtInput,
  Settlement,
  SettlementInput,
  LedgerMember,
  LedgerInvite,
  BillCategory,
} from "@t-box/ledger-contracts";
import { request } from "../sdk";
export const bookPath = (id: string) => `/ledgers/${encodeURIComponent(id)}`;
const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
export const booksApi = {
  list: () => request<{ data: Ledger[] }>("/ledgers"),
  create: (input: LedgerInput) =>
    request<{ data: Ledger }>("/ledgers", json("POST", input)),
  get: (id: string) => request<{ data: Ledger }>(bookPath(id)),
  update: (id: string, input: { name?: string; archived?: boolean }) =>
    request<{ data: Ledger }>(bookPath(id), json("PATCH", input)),
  join: (token: string) =>
    request<{ data: Ledger }>(
      "/ledger-invitations/accept",
      json("POST", { token }),
    ),
  unlock: (id: string, password: string) =>
    request<{ data: Ledger }>(
      `${bookPath(id)}/unlock`,
      json("POST", { password }),
    ),
  lock: (id: string) =>
    request<{ data: Ledger }>(`${bookPath(id)}/unlock`, { method: "DELETE" }),
  password: (id: string, accountPassword: string, password: string | null) =>
    request<{ data: Ledger }>(
      `${bookPath(id)}/password`,
      json("PATCH", { accountPassword, password }),
    ),
  members: (id: string) =>
    request<{ data: LedgerMember[] }>(`${bookPath(id)}/members`),
  role: (id: string, user: string, role: string) =>
    request(`${bookPath(id)}/members/${user}`, json("PATCH", { role })),
  remove: (id: string, user: string) =>
    request(`${bookPath(id)}/members/${user}`, { method: "DELETE" }),
  transfer: (id: string, userId: string) =>
    request(`${bookPath(id)}/transfer`, json("POST", { userId })),
  invites: (id: string) =>
    request<{ data: LedgerInvite[] }>(`${bookPath(id)}/invites`),
  invite: (
    id: string,
    input: { role: string; maxUses: number; days: number },
  ) =>
    request<{ data: { id: string; token: string } }>(
      `${bookPath(id)}/invites`,
      json("POST", input),
    ),
  revoke: (id: string, invite: string) =>
    request(`${bookPath(id)}/invites/${invite}`, { method: "DELETE" }),
  statistics: (
    id: string,
    period: StatisticPeriod,
    value: string,
    signal?: AbortSignal,
  ) =>
    request<{ data: LedgerStatistics }>(
      `${bookPath(id)}/statistics?${new URLSearchParams({ period, value })}`,
      { signal },
    ),
  categories: (id: string, signal?: AbortSignal) =>
    request<{ data: BillCategory[] }>(`${bookPath(id)}/categories`, { signal }),
  debts: (id: string, query = new URLSearchParams()) =>
    request<{
      data: Debt[];
      meta: { page: number; pageSize: number; total: number };
    }>(`${bookPath(id)}/debts?${query}`),
  debt: (id: string, input: DebtInput, key: string) =>
    request<{ data: Debt }>(`${bookPath(id)}/debts`, {
      ...json("POST", input),
      headers: { "Idempotency-Key": key },
    }),
  settlements: (id: string) =>
    request<{ data: Settlement[] }>(`${bookPath(id)}/settlements`),
  settle: (id: string, input: SettlementInput, key: string) =>
    request<{ data: Settlement }>(`${bookPath(id)}/settlements`, {
      ...json("POST", input),
      headers: { "Idempotency-Key": key },
    }),
  reverse: (id: string, settlement: string) =>
    request(
      `${bookPath(id)}/settlements/${settlement}/reversal`,
      json("POST", {}),
    ),
  events: (id: string, start: string, end: string, page = 1) =>
    request<{ data: FinanceEvent[]; meta: { total: number } }>(
      `${bookPath(id)}/events?${new URLSearchParams({ start, end, page: String(page), pageSize: "20" })}`,
    ),
  history: (id: string) =>
    request<{
      data: {
        id: string;
        action: string;
        actor: string | null;
        createdAt: string;
      }[];
    }>(`${bookPath(id)}/history`),
  rebuild: (id: string) =>
    request(`${bookPath(id)}/statistics/rebuild`, json("POST", {})),
};
export interface FinanceEvent {
  id: string;
  subjectId: string;
  kind: string;
  date: string;
  income: string;
  expense: string;
  inflow: string;
  outflow: string;
  receivableChange: string;
  payableChange: string;
  note: string;
  createdBy: string | null;
}
