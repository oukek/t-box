import type { LedgerRole, LedgerTemplate } from '@t-box/ledger-contracts'
import type { AppUser } from '@t-box/shared'

export interface Principal {
  user: AppUser
  sessionHash: string
}
export interface LedgerRow {
  id: string
  name: string
  template: LedgerTemplate
  currency: 'CNY'
  owner_id: string | null
  archived: number
  password_hash: string | null
  password_version: number
  revision: string | number
}
export interface Access {
  book: LedgerRow
  role: LedgerRole
  locked: boolean
}
