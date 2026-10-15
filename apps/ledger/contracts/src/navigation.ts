/** Ledger routes, including query-string bookmarks, are validated by the ledger module. */
export function parseLedgerParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('记账页面参数无效')
  }
  const args = value as Record<string, unknown>
  if (
    Object.keys(args).some(
      (key) => !['ledgerId', 'month', 'billId', 'inviteToken'].includes(key),
    )
  ) {
    throw new Error('记账页面包含未支持的参数')
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
      throw new Error('账本或账单标识无效')
    }
    result[key] = entry
  }
  if (args.month != null) {
    if (
      typeof args.month !== 'string' ||
      !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(args.month)
    ) {
      throw new Error('账单月份无效')
    }
    result.month = args.month
  }
  if (args.inviteToken !== undefined) {
    if (typeof args.inviteToken !== 'string' || !/^[\w-]{16,200}$/.test(args.inviteToken)) {
      throw new Error('邀请口令无效')
    }
    result.inviteToken = args.inviteToken
  }
  return result
}
