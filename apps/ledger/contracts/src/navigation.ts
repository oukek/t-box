import { ErrorCode } from './error-codes.js'
/** Ledger routes, including query-string bookmarks, are validated by the ledger module. */
export function parseLedgerParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ErrorCode.INTERNAL_INVALID_LEDGER_NAVIGATION()
  }
  const args = value as Record<string, unknown>
  if (
    Object.keys(args).some(
      (key) => !['ledgerId', 'month', 'billId', 'inviteToken'].includes(key),
    )
  ) {
    throw ErrorCode.INTERNAL_UNSUPPORTED_LEDGER_NAVIGATION()
  }
  const result: Record<string, string> = {}
  for (const key of ['ledgerId', 'billId']) {
    const entry = args[key]
    if (entry == null) {
      continue
    }
    if (
      typeof entry !== 'string' ||
      !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
        entry,
      )
    ) {
      throw ErrorCode.INTERNAL_INVALID_LEDGER_RESOURCE_ID()
    }
    result[key] = entry
  }
  if (args.month != null) {
    if (
      typeof args.month !== 'string' ||
      !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(args.month)
    ) {
      throw ErrorCode.INTERNAL_INVALID_BILL_MONTH()
    }
    result.month = args.month
  }
  if (args.inviteToken !== undefined) {
    if (
      typeof args.inviteToken !== 'string' ||
      !/^[\w-]{16,200}$/.test(args.inviteToken)
    ) {
      throw ErrorCode.INTERNAL_INVALID_INVITATION_TOKEN()
    }
    result.inviteToken = args.inviteToken
  }
  return result
}
