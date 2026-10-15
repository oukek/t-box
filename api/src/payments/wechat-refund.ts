import type { PaymentConfiguration, WechatRuntime } from './configuration.js'
import type { VerifiedRefund } from './gateway.js'
import {
  decryptWechat,
  localOrder,
  verifyWechat,
  wechatFailure,
} from './wechat-message.js'

export function parseWechatRefund(
  data: Record<string, unknown>,
  config: WechatRuntime,
  notification = false,
): VerifiedRefund {
  const amount = data.amount as Record<string, unknown> | undefined
  const status = notification ? data.refund_status : data.status
  if (
    !['SUCCESS', 'PROCESSING', 'CLOSED', 'ABNORMAL'].includes(String(status)) ||
    !amount ||
    !Number.isSafeInteger(amount.refund) ||
    !Number.isSafeInteger(amount.total) ||
    Number(amount.refund) <= 0 ||
    Number(amount.total) < Number(amount.refund) ||
    ((!notification || amount.currency !== undefined) &&
      amount.currency !== 'CNY') ||
      typeof data.refund_id !== 'string' ||
      !/^\d{10,64}$/.test(data.refund_id) ||
      typeof data.transaction_id !== 'string' ||
      !/^\d{10,100}$/.test(data.transaction_id) ||
      (notification && data.mchid !== config.merchantId)
  ) {
    throw wechatFailure('微信退款响应校验失败，请核对原退款单')
  }
  return {
    ...(typeof data.success_time === 'string' &&
      Number.isFinite(Date.parse(data.success_time))
      ? { succeededAt: new Date(data.success_time) }
      : {}),
    id: localOrder(data.out_refund_no),
    orderId: localOrder(data.out_trade_no),
    configurationId: config.id,
    refundId: data.refund_id,
    transactionId: data.transaction_id,
    amountCents: Number(amount.refund),
    totalCents: Number(amount.total),
    currency: 'CNY',
    status: status as VerifiedRefund['status'],
  }
}

export async function verifyWechatRefund(
  configuration: PaymentConfiguration,
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
) {
  if (
    !Buffer.isBuffer(raw) ||
    raw.length > 64 * 1024 ||
    typeof headers['wechatpay-serial'] !== 'string'
  ) {
    throw wechatFailure()
  }
  const rows = await configuration.source.query(
    'SELECT id FROM payment_configurations ORDER BY version DESC',
  )
  let authenticated = false
  for (const row of rows) {
    const config = await configuration.runtime(row.id)
    if (!config || config.platformSerial !== headers['wechatpay-serial']) {
      continue
    }
    try {
      verifyWechat(raw, headers, config)
      authenticated = true
      break
    } catch {}
  }
  if (!authenticated) {
    throw wechatFailure('微信退款通知验签失败')
  }
  const envelope = JSON.parse(raw.toString())
  if (
    !['REFUND.SUCCESS', 'REFUND.CLOSED', 'REFUND.ABNORMAL'].includes(
      envelope.event_type,
    ) ||
    envelope.resource_type !== 'encrypt-resource'
  ) {
    throw wechatFailure()
  }
  for (const row of rows) {
    const candidate = await configuration.runtime(row.id)
    if (!candidate) {
      continue
    }
    let data: Record<string, unknown>
    try {
      data = decryptWechat(envelope.resource, candidate.apiV3Key, 'refund')
    } catch {
      continue
    }
    const [refund] = await configuration.source.query(
      `SELECT o.configuration_id FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id WHERE r.id=? AND o.id=?`,
      [localOrder(data.out_refund_no), localOrder(data.out_trade_no)],
    )
    const bound = refund?.configuration_id
      ? await configuration.runtime(refund.configuration_id)
      : null
    if (
      !bound ||
      bound.merchantId !== candidate.merchantId ||
      data.mchid !== bound.merchantId ||
      `REFUND.${data.refund_status}` !== envelope.event_type
    ) {
      continue
    }
    return parseWechatRefund(data, bound, true)
  }
  throw wechatFailure('微信退款通知解密或商户校验失败')
}
