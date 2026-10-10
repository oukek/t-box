import { LEDGER_ATTACHMENT_LIMIT } from '@t-box/ledger-contracts'
import { invalid } from '@t-box/server-foundation/errors'
import { parseId } from '@t-box/server-foundation/validation'

export function attachmentIds(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.length > LEDGER_ATTACHMENT_LIMIT) {
    invalid('attachmentResourceIds', '每笔最多 20 个附件')
  }
  const ids = value.map(parseId)
  if (new Set(ids).size !== ids.length) {
    invalid('attachmentResourceIds', '附件不能重复')
  }
  return ids
}
