import type { MerchantStatement } from './gateway.js'
import { ErrorCode } from '../error-codes.js'

const invalid = () => ErrorCode.STATEMENT_INVALID()
/** Quoted CSV cells plus WeChat's leading backtick; personal/bank fields never leave this parser. */
export function parseStatementCSV(
  text: string,
  merchantId: string,
): MerchantStatement['rows'] {
  const records: string[][] = []
  let record: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index <= text.length; index++) {
    const char = text[index] ?? '\n'
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"'
        index++
      } else if (quoted || cell === '' || cell === '`') {
        quoted = !quoted
      } else {
        cell += char
      }
    } else if (!quoted && (char === ',' || char === '\n')) {
      record.push(
        cell
          .replace(/^\uFEFF/, '')
          .replace(/^`/, '')
          .replace(/\r$/, ''),
      )
      cell = ''
      if (char === '\n') {
        if (record.some(Boolean)) {
          records.push(record)
        }
        record = []
      }
    } else {
      cell += char
    }
  }
  if (quoted || records.length > 200002) {
    throw invalid()
  }
  const [headers, ...data] = records
  if (!headers) {
    throw invalid()
  }
  const index = (name: string, fallback?: string) => {
    const found = headers.indexOf(name)
    const result =
      found >= 0 ? found : fallback ? headers.indexOf(fallback) : -1
    if (result < 0) {
      throw invalid()
    }
    return result
  }
  const fields = {
    merchant: index('商户号'),
    order: index('商户订单号'),
    transaction: index('微信订单号'),
    status: index('交易状态'),
    currency: index('货币种类'),
    amount: index('订单金额', '总金额'),
    refundAmount: index('申请退款金额', '退款金额'),
    refund: index('商户退款单号'),
    refundTransaction: index('微信退款单号'),
  }
  const rows: MerchantStatement['rows'] = []
  const seen = new Set<string>()
  for (const row of data) {
    if (row[0] === '总交易单数') {
      break
    }
    if (
      row.length !== headers.length ||
      row[fields.merchant] !== merchantId ||
      row[fields.currency] !== 'CNY'
    ) {
      throw invalid()
    }
    const state = row[fields.status]
    if (!['SUCCESS', 'REFUND', 'REVOKED'].includes(state!)) {
      throw invalid()
    }
    const amount =
      row[state === 'REFUND' ? fields.refundAmount : fields.amount]!
    if (!/^\d{1,9}\.\d{2}$/.test(amount)) {
      throw invalid()
    }
    const amountCents = Number(amount.replace('.', ''))
    const key =
      row[fields.order] +
      ':' +
      (state === 'REFUND' ? row[fields.refund] : state)
    if (seen.has(key)) {
      throw invalid()
    }
    seen.add(key)
    rows.push({
      kind:
        state === 'REFUND'
          ? 'refund'
          : state === 'REVOKED'
            ? 'reversal'
            : 'payment',
      orderId: row[fields.order]!,
      transactionId: row[fields.transaction]!,
      amountCents,
      ...(state === 'REFUND'
        ? {
            merchantRefundId: row[fields.refund],
            refundId: row[fields.refundTransaction],
          }
        : {}),
    })
  }
  return rows
}
