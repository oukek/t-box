import type {
  PaymentCapabilities,
  PaymentIntent,
  PaymentOrder,
  WechatPaymentMode,
} from '@t-box/shared'
import type { PaymentConfiguration, WechatRuntime } from './configuration.js'
import type {
  PaymentContext,
  PaymentGateway,
  RefundRequest,
  VerifiedPayment,
} from './gateway.js'
import { createHash, randomBytes, sign } from 'node:crypto'
import { isIP } from 'node:net'
import { ApiError } from '@t-box/server-foundation/errors'
import {
  PaymentConfigurationEntity,
  PaymentOrderEntity,
} from '../db/records/payments-entities.js'
import { ErrorCode } from '../error-codes.js'
import { parseStatementCSV } from './statement.js'
import { WechatAuthorization } from './wechat-authorization.js'
import {
  decryptWechat,
  wechatFailure as fail,
  localOrder,
  merchantOrder,
  readWechatBody,
  verifyWechat,
} from './wechat-message.js'
import { parseWechatRefund, verifyWechatRefund } from './wechat-refund.js'

export {
  decryptWechat,
  localOrder,
  merchantOrder,
  verifyWechat,
} from './wechat-message.js'

function payment(
  data: Record<string, unknown>,
  c: WechatRuntime,
  mode: WechatPaymentMode = 'native',
): VerifiedPayment | null {
  const expectedAppId = mode === 'app' ? c.mobileAppId : c.appId
  if (
    !expectedAppId ||
    data.mchid !== c.merchantId ||
    data.appid !== expectedAppId ||
    data.trade_type !== mode.toUpperCase()
  ) {
    throw fail()
  }
  if (data.trade_state !== 'SUCCESS') {
    return null
  }
  const amount = data.amount as Record<string, unknown> | undefined
  if (
    !amount ||
    !Number.isSafeInteger(amount.total) ||
    Number(amount.total) <= 0 ||
    amount.currency !== 'CNY' ||
    typeof data.transaction_id !== 'string' ||
    !/^\d{10,100}$/.test(data.transaction_id) ||
    typeof data.success_time !== 'string' ||
    !Number.isFinite(Date.parse(data.success_time))
  ) {
    throw fail()
  }
  return {
    orderId: localOrder(data.out_trade_no),
    transactionId: data.transaction_id,
    amountCents: Number(amount.total),
    currency: 'CNY',
    paidAt: new Date(data.success_time),
    configurationId: c.id,
  }
}
/** Direct merchant API v3, fixed upstream host, RSA signatures, pinned trusted verification keys. */
export class WechatGateway implements PaymentGateway {
  readonly channel = 'wechat'
  readonly authorization: WechatAuthorization
  constructor(
    readonly configuration: PaymentConfiguration,
    private transport: typeof fetch = fetch,
  ) {
    this.authorization = new WechatAuthorization(configuration, transport)
  }

  async capabilities(): Promise<PaymentCapabilities> {
    const c = await this.configuration.runtime()
    return {
      enabled: !!c?.enabled,
      channel: 'wechat',
      ...(c?.enabled && c.app ? { mobileAppId: c.mobileAppId } : {}),
      modes: c?.enabled
        ? (['native', 'h5', 'jsapi', 'app'] as const).filter((x) => c[x])
        : [],
    }
  }

  async configurationId() {
    const c = await this.configuration.runtime()
    if (!c?.enabled) {
      throw ErrorCode.PAYMENT_NOT_CONFIGURED('在线充值尚未开放')
    }
    return c.id
  }

  private async config(context?: PaymentContext) {
    if (!context?.configurationId) {
      throw fail('此订单没有可用的商户配置，请联系管理员核对')
    }
    const c = await this.configuration.runtime(context.configurationId)
    if (!c) {
      throw fail()
    }
    return this.configuration.credentials(c)
  }

  private async send(
    c: WechatRuntime,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const text = body === undefined ? '' : JSON.stringify(body)
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = randomBytes(16).toString('hex')
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${text}\n`),
      c.privateKey,
    ).toString('base64')
    let response: Response
    try {
      response = await this.transport(`https://api.mch.weixin.qq.com${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Wechatpay-Serial': c.platformSerial,
          'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${c.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${c.merchantSerial}",signature="${signature}"`,
        },
        ...(text ? { body: text } : {}),
      })
    } catch {
      throw fail('微信支付连接未完成，请核对原订单后重试')
    }
    return response
  }

  private async request(
    c: WechatRuntime,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await this.send(c, method, path, body)
    const raw =
      response.status === 204
        ? Buffer.alloc(0)
        : await readWechatBody(response, 64 * 1024)
    verifyWechat(raw, Object.fromEntries(response.headers), c)
    if (response.status === 204) {
      return {}
    }
    let json: Record<string, unknown>
    try {
      json = JSON.parse(raw.toString('utf8'))
    } catch {
      throw fail()
    }
    if (!response.ok) {
      if (json.code === 'NO_STATEMENT_EXIST') {
        throw ErrorCode.STATEMENT_EMPTY()
      }
      if (
        response.status === 404 &&
        json.code === 'RESOURCE_NOT_EXISTS' &&
        path.startsWith('/v3/refund/domestic/refunds/')
      ) {
        throw ErrorCode.REFUND_NOT_FOUND('渠道暂未查到此退款单')
      }
      if (json.code === 'ORDERPAID') {
        throw ErrorCode.ORDER_PAID('订单已支付，请刷新核对到账状态')
      }
      throw fail(
        '微信支付下单未完成，请检查商户权限与支付域名配置；原订单仍可核对',
      )
    }
    return json
  }

  async refund(input: RefundRequest, context: PaymentContext) {
    const c = await this.config(context)
    const result = parseWechatRefund(
      await this.request(c, 'POST', '/v3/refund/domestic/refunds', {
        transaction_id: input.transactionId,
        out_refund_no: merchantOrder(input.id),
        reason: input.reason,
        notify_url: `${c.apiBaseUrl}/api/v1/payments/webhooks/wechat/refunds`,
        amount: {
          refund: input.amountCents,
          total: input.amountCents,
          currency: 'CNY',
        },
      }),
      c,
    )
    if (
      result.id !== input.id ||
      result.orderId !== input.orderId ||
      result.transactionId !== input.transactionId ||
      result.amountCents !== input.amountCents
    ) {
      throw fail('微信退款结果与原退款单不一致')
    }
    return result
  }

  async statement(day: string, context: PaymentContext) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw ErrorCode.STATEMENT_DATE('账单日期无效')
    }
    const c = await this.config(context)
    let metadata: Record<string, unknown>
    try {
      metadata = await this.request(
        c,
        'GET',
        `/v3/bill/tradebill?bill_date=${day}&bill_type=ALL`,
      )
    } catch (error) {
      if (error instanceof ApiError && error.code === 'STATEMENT_EMPTY') {
        return { day, merchantId: c.merchantId, sha1: '', rows: [] }
      }
      throw error
    }
    if (
      metadata.hash_type !== 'SHA1' ||
      typeof metadata.hash_value !== 'string' ||
      !/^[a-f0-9]{40}$/i.test(metadata.hash_value) ||
      typeof metadata.download_url !== 'string'
    ) {
      throw fail('微信账单摘要无效')
    }
    const url = new URL(metadata.download_url)
    if (
      url.origin !== 'https://api.mch.weixin.qq.com' ||
      url.username ||
      url.password ||
      url.hash ||
      !['/v3/billdownload/file', '/v3/bill/downloadurl'].includes(url.pathname)
    ) {
      throw fail('微信账单下载来源无效')
    }
    const response = await this.send(c, 'GET', url.pathname + url.search)
    if (!response.ok) {
      throw fail('微信账单下载尚未完成')
    }
    // File responses use the authenticated metadata hash per WeChat's two-step
    // protocol. Normal API response signature verification remains mandatory.
    const bytes = await readWechatBody(response, 20 * 1024 * 1024)
    const sha1 = createHash('sha1').update(bytes).digest('hex')
    if (sha1 !== metadata.hash_value.toLowerCase()) {
      throw fail('微信账单文件校验失败')
    }
    return {
      day,
      merchantId: c.merchantId,
      sha1,
      rows: parseStatementCSV(bytes.toString('utf8'), c.merchantId),
    }
  }

  async queryRefund(id: string, context: PaymentContext) {
    const c = await this.config(context)
    try {
      const result = parseWechatRefund(
        await this.request(
          c,
          'GET',
          `/v3/refund/domestic/refunds/${merchantOrder(id)}`,
        ),
        c,
      )
      if (result.id !== id) {
        throw fail()
      }
      return result
    } catch (error) {
      if (error instanceof ApiError && error.code === 'REFUND_NOT_FOUND') {
        return null
      }
      throw error
    }
  }

  verifyRefund(
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    return verifyWechatRefund(this.configuration, raw, headers)
  }

  async create(
    order: PaymentOrder,
    amountCents: number,
    context?: PaymentContext,
  ): Promise<PaymentIntent> {
    const c = await this.config(context)
    const mode = context?.mode ?? 'native'
    if (!c[mode]) {
      throw ErrorCode.PAYMENT_MODE_DISABLED()
    }
    const body: Record<string, unknown> = {
      appid: mode === 'app' ? c.mobileAppId : c.appId,
      mchid: c.merchantId,
      description: c.description,
      out_trade_no: merchantOrder(order.id),
      time_expire: new Date(order.expiresAt)
        .toISOString()
        .replace(/\.\d{3}Z$/, '+00:00'),
      notify_url: `${c.apiBaseUrl}/api/v1/payments/webhooks/wechat`,
      amount: { total: amountCents, currency: 'CNY' },
    }
    if (mode === 'jsapi') {
      if (!context?.userId) {
        throw fail()
      }
      const openid = await this.authorization.openid(context.userId, c.appId)
      if (!openid) {
        return {
          type: 'redirect',
          url: await this.authorization.start(context.userId, order.id, c),
        }
      }
      body.payer = { openid }
    }
    if (mode === 'h5') {
      if (!context?.clientIp || !isIP(context.clientIp)) {
        throw fail('无法获取用户终端 IP，请检查可信代理配置')
      }
      body.scene_info = {
        payer_client_ip: context.clientIp,
        h5_info: { type: 'Wap', app_name: 'T Box', app_url: c.frontendUrl },
      }
    }
    const response = await this.request(
      c,
      'POST',
      `/v3/pay/transactions/${mode}`,
      body,
    )
    if (mode === 'native') {
      if (
        typeof response.code_url !== 'string' ||
        !response.code_url.startsWith('weixin://wxpay/') ||
        response.code_url.length > 1024
      ) {
        throw fail()
      }
      return { type: 'qr', codeUrl: response.code_url }
    }
    if (mode === 'h5') {
      if (typeof response.h5_url !== 'string') {
        throw fail()
      }
      const url = new URL(response.h5_url)
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'wx.tenpay.com' ||
        url.username ||
        url.password
      ) {
        throw fail()
      }
      return {
        type: 'redirect',
        url: `${response.h5_url}&redirect_url=${encodeURIComponent(this.authorization.returnUrl(c, order.id))}`,
      }
    }
    if (
      typeof response.prepay_id !== 'string' ||
      !/^[\w-]{1,128}$/.test(response.prepay_id)
    ) {
      throw fail()
    }
    if (mode === 'app') {
      const timeStamp = Math.floor(Date.now() / 1000).toString()
      const nonceStr = randomBytes(16).toString('hex')
      const prepayId = response.prepay_id
      // APP signs raw prepay_id, unlike JSAPI's "prepay_id=…" package.
      const signature = sign(
        'RSA-SHA256',
        Buffer.from(
          `${c.mobileAppId}\n${timeStamp}\n${nonceStr}\n${prepayId}\n`,
        ),
        c.privateKey,
      ).toString('base64')
      return {
        type: 'app',
        parameters: {
          appId: c.mobileAppId,
          partnerId: c.merchantId,
          prepayId,
          packageValue: 'Sign=WXPay',
          nonceStr,
          timeStamp,
          sign: signature,
        },
      }
    }
    const timeStamp = Math.floor(Date.now() / 1000).toString()
    const nonceStr = randomBytes(16).toString('hex')
    const pkg = `prepay_id=${response.prepay_id}`
    const paySign = sign(
      'RSA-SHA256',
      Buffer.from(`${c.appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`),
      c.privateKey,
    ).toString('base64')
    return {
      type: 'jsapi',
      parameters: {
        appId: c.appId,
        timeStamp,
        nonceStr,
        package: pkg,
        signType: 'RSA',
        paySign,
      },
    }
  }

  async close(orderId: string, context?: PaymentContext) {
    const c = await this.config(context)
    await this.request(
      c,
      'POST',
      `/v3/pay/transactions/out-trade-no/${merchantOrder(orderId)}/close`,
      { mchid: c.merchantId },
    )
  }

  async query(orderId: string, context?: PaymentContext) {
    const c = await this.config(context)
    const response = await this.request(
      c,
      'GET',
      `/v3/pay/transactions/out-trade-no/${merchantOrder(orderId)}?mchid=${c.merchantId}`,
    )
    const event = payment(response, c, context?.mode)
    if (event && event.orderId !== orderId) {
      throw fail()
    }
    return event
  }

  async verify(
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    if (
      raw.length > 64 * 1024 ||
      typeof headers['wechatpay-serial'] !== 'string'
    ) {
      throw fail()
    }
    const keys = await this.configuration.source
      .createQueryBuilder()
      .select('id')
      .from('payment_configurations', 'payment_configurations')
      .where('JSON_UNQUOTE(JSON_EXTRACT(public_json,\'$.platformSerial\'))=:p0')
      .orderBy('version', 'DESC')
      .setParameters({ p0: headers['wechatpay-serial'] })
      .getRawMany()
    let authenticated = false
    for (const row of keys) {
      const c = await this.configuration.runtime(row.id)
      if (!c) {
        continue
      }
      try {
        verifyWechat(raw, headers, c)
        authenticated = true
        break
      } catch {
        continue
      }
    }
    if (!authenticated) {
      throw ErrorCode.PAYMENT_SIGNATURE_INVALID()
    }
    let envelope: {
      event_type?: string
      resource_type?: string
      resource: Record<string, unknown>
    }
    try {
      envelope = JSON.parse(raw.toString('utf8'))
    } catch {
      throw fail()
    }
    if (
      envelope.event_type !== 'TRANSACTION.SUCCESS' ||
      envelope.resource_type !== 'encrypt-resource'
    ) {
      throw fail()
    }
    const rows = await this.configuration.source
      .getRepository(PaymentConfigurationEntity)
      .find({ select: { id: true }, order: { version: 'DESC' } })
    const tried = new Set<string>()
    for (const row of rows) {
      const c = await this.configuration.runtime(row.id)
      if (!c || tried.has(c.apiV3Key)) {
        continue
      }
      tried.add(c.apiV3Key)
      let data: Record<string, unknown>
      try {
        data = decryptWechat(envelope.resource, c.apiV3Key)
      } catch {
        continue
      }
      const orderId = localOrder(data.out_trade_no)
      const order = await this.configuration.source
        .getRepository(PaymentOrderEntity)
        .findOne({
          select: { id: true, configuration_id: true, payment_mode: true },
          where: { id: orderId },
        })
      if (!order?.configuration_id) {
        break
      }
      const bound = await this.configuration.runtime(order.configuration_id)
      // Verification-key rotation is independent of a pending order's merchant identity. API-v3 keys also rotate globally.
      if (!bound || bound.merchantId !== c.merchantId) {
        tried.delete(c.apiV3Key)
        continue
      }
      const event = payment(data, bound, order.payment_mode ?? 'native')
      if (event) {
        return event
      }
    }
    throw ErrorCode.PAYMENT_SIGNATURE_INVALID('支付通知解密或订单商户校验失败')
  }
}
