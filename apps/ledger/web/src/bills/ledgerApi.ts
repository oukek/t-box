import type {
  Bill,
  BillCategory,
  BillInput,
  BillListResponse,
  BillSummary,
} from '@t-box/ledger-contracts'
import { request } from '../sdk'

export const createLedgerApi = (ledgerId: string) => {
  const base = `/ledgers/${encodeURIComponent(ledgerId)}`
  return {
    categories(signal?: AbortSignal) {
      return request<{ data: BillCategory[] }>(`${base}/categories`, {
        signal,
      })
    },
    list(params: URLSearchParams, signal: AbortSignal) {
      return request<BillListResponse>(`${base}/bills?${params}`, { signal })
    },
    summary(month: string, signal: AbortSignal) {
      return request<{ data: BillSummary }>(
        `${base}/bills/summary?month=${encodeURIComponent(month)}`,
        { signal },
      )
    },
    create(input: BillInput, key: string) {
      return request<{ data: Bill }>(`${base}/bills`, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': key },
      })
    },
    update(id: string, input: BillInput, key: string) {
      return request<{ data: Bill }>(
        `${base}/bills/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(input),
          headers: { 'Idempotency-Key': key },
        },
      )
    },
    remove(id: string) {
      return request<void>(`${base}/bills/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
    },
  }
}
