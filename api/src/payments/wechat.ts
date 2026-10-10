import { createDecipheriv, randomBytes, sign, verify } from "node:crypto";
import { isIP } from "node:net";
import type {
  PaymentOrder,
  PaymentIntent,
  PaymentCapabilities,
  WechatPaymentMode,
} from "@t-box/shared";
import type {
  PaymentGateway,
  VerifiedPayment,
  PaymentContext,
} from "./gateway.js";
import { PaymentConfiguration, type WechatRuntime } from "./configuration.js";
import { WechatAuthorization } from "./wechat-authorization.js";
import { ApiError } from "@t-box/server-foundation/errors";
const fail = (message = "微信支付响应校验失败，请稍后核对订单") =>
  new ApiError(502, "WECHAT_UNAVAILABLE", message);
export function merchantOrder(id: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    throw fail();
  return id.replaceAll("-", "");
}
export function localOrder(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/i.test(value)) throw fail();
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`.toLowerCase();
}
export function verifyWechat(
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
  config: WechatRuntime,
  now = Date.now(),
) {
  const timestamp = headers["wechatpay-timestamp"],
    nonce = headers["wechatpay-nonce"],
    signature = headers["wechatpay-signature"],
    serial = headers["wechatpay-serial"];
  if (
    typeof timestamp !== "string" ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    typeof nonce !== "string" ||
    !/^[\x21-\x7e]{1,128}$/.test(nonce) ||
    typeof signature !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(signature) ||
    signature.length > 2048 ||
    serial !== config.platformSerial
  )
    throw fail();
  const payload = Buffer.concat([
    Buffer.from(`${timestamp}\n${nonce}\n`),
    raw,
    Buffer.from("\n"),
  ]);
  if (
    !verify(
      "RSA-SHA256",
      payload,
      config.platformPublicKey,
      Buffer.from(signature, "base64"),
    )
  )
    throw fail();
}
export function decryptWechat(
  resource: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  if (
    resource.algorithm !== "AEAD_AES_256_GCM" ||
    resource.original_type !== "transaction" ||
    typeof resource.nonce !== "string" ||
    Buffer.byteLength(resource.nonce) !== 12 ||
    typeof resource.ciphertext !== "string" ||
    typeof resource.associated_data !== "string"
  )
    throw fail();
  try {
    const bytes = Buffer.from(resource.ciphertext, "base64");
    if (bytes.length <= 16) throw new Error();
    const cipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key),
      Buffer.from(resource.nonce),
    );
    cipher.setAuthTag(bytes.subarray(-16));
    cipher.setAAD(Buffer.from(resource.associated_data));
    return JSON.parse(
      Buffer.concat([
        cipher.update(bytes.subarray(0, -16)),
        cipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw fail();
  }
}
function payment(
  data: Record<string, unknown>,
  c: WechatRuntime,
  mode: WechatPaymentMode = "native",
): VerifiedPayment | null {
  const expectedAppId = mode === "app" ? c.mobileAppId : c.appId;
  if (
    !expectedAppId ||
    data.mchid !== c.merchantId ||
    data.appid !== expectedAppId ||
    data.trade_type !== mode.toUpperCase()
  )
    throw fail();
  if (data.trade_state !== "SUCCESS") return null;
  const amount = data.amount as Record<string, unknown> | undefined;
  if (
    !amount ||
    !Number.isSafeInteger(amount.total) ||
    Number(amount.total) <= 0 ||
    amount.currency !== "CNY" ||
    typeof data.transaction_id !== "string" ||
    !/^\d{10,100}$/.test(data.transaction_id) ||
    typeof data.success_time !== "string" ||
    !Number.isFinite(Date.parse(data.success_time))
  )
    throw fail();
  return {
    orderId: localOrder(data.out_trade_no),
    transactionId: data.transaction_id,
    amountCents: Number(amount.total),
    currency: "CNY",
    paidAt: new Date(data.success_time),
    configurationId: c.id,
  };
}
/** Direct merchant API v3, fixed upstream host, RSA signatures, pinned trusted verification keys. */
export class WechatGateway implements PaymentGateway {
  readonly channel = "wechat";
  readonly authorization: WechatAuthorization;
  constructor(
    readonly configuration: PaymentConfiguration,
    private transport: typeof fetch = fetch,
  ) {
    this.authorization = new WechatAuthorization(configuration, transport);
  }
  async capabilities(): Promise<PaymentCapabilities> {
    const c = await this.configuration.runtime();
    return {
      enabled: !!c?.enabled,
      channel: "wechat",
      ...(c?.enabled && c.app ? { mobileAppId: c.mobileAppId } : {}),
      modes: c?.enabled
        ? (["native", "h5", "jsapi", "app"] as const).filter((x) => c[x])
        : [],
    };
  }
  async configurationId() {
    const c = await this.configuration.runtime();
    if (!c?.enabled)
      throw new ApiError(503, "PAYMENT_NOT_CONFIGURED", "在线充值尚未开放");
    return c.id;
  }
  private async config(context?: PaymentContext) {
    if (!context?.configurationId)
      throw fail("此订单没有可用的商户配置，请联系管理员核对");
    const c = await this.configuration.runtime(context.configurationId);
    if (!c) throw fail();
    return this.configuration.credentials(c);
  }
  private async request(
    c: WechatRuntime,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const text = body === undefined ? "" : JSON.stringify(body),
      timestamp = Math.floor(Date.now() / 1000).toString(),
      nonce = randomBytes(16).toString("hex");
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${text}\n`),
      c.privateKey,
    ).toString("base64");
    let response: Response;
    try {
      response = await this.transport(`https://api.mch.weixin.qq.com${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Wechatpay-Serial": c.platformSerial,
          Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${c.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${c.merchantSerial}",signature="${signature}"`,
        },
        ...(text ? { body: text } : {}),
      });
    } catch {
      throw fail("微信支付连接未完成，请核对原订单后重试");
    }
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length > 64 * 1024) throw fail();
    verifyWechat(raw, Object.fromEntries(response.headers), c);
    if (response.status === 204) return {};
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw.toString("utf8"));
    } catch {
      throw fail();
    }
    if (!response.ok) {
      if (json.code === "ORDERPAID")
        throw new ApiError(409, "ORDER_PAID", "订单已支付，请刷新核对到账状态");
      throw fail(
        "微信支付下单未完成，请检查商户权限与支付域名配置；原订单仍可核对",
      );
    }
    return json;
  }
  async create(
    order: PaymentOrder,
    amountCents: number,
    context?: PaymentContext,
  ): Promise<PaymentIntent> {
    const c = await this.config(context),
      mode = context?.mode ?? "native";
    if (!c[mode])
      throw new ApiError(
        409,
        "PAYMENT_MODE_DISABLED",
        "当前客户端对应的支付方式尚未开放",
      );
    const body: Record<string, unknown> = {
      appid: mode === "app" ? c.mobileAppId : c.appId,
      mchid: c.merchantId,
      description: c.description,
      out_trade_no: merchantOrder(order.id),
      time_expire: new Date(order.expiresAt)
        .toISOString()
        .replace(/\.\d{3}Z$/, "+00:00"),
      notify_url: `${c.apiBaseUrl}/api/v1/payments/webhooks/wechat`,
      amount: { total: amountCents, currency: "CNY" },
    };
    if (mode === "jsapi") {
      if (!context?.userId) throw fail();
      const openid = await this.authorization.openid(context.userId, c.appId);
      if (!openid)
        return {
          type: "redirect",
          url: await this.authorization.start(context.userId, order.id, c),
        };
      body.payer = { openid };
    }
    if (mode === "h5") {
      if (!context?.clientIp || !isIP(context.clientIp))
        throw fail("无法获取用户终端 IP，请检查可信代理配置");
      body.scene_info = {
        payer_client_ip: context.clientIp,
        h5_info: { type: "Wap", app_name: "T Box", app_url: c.frontendUrl },
      };
    }
    const response = await this.request(
      c,
      "POST",
      `/v3/pay/transactions/${mode}`,
      body,
    );
    if (mode === "native") {
      if (
        typeof response.code_url !== "string" ||
        !response.code_url.startsWith("weixin://wxpay/") ||
        response.code_url.length > 1024
      )
        throw fail();
      return { type: "qr", codeUrl: response.code_url };
    }
    if (mode === "h5") {
      if (typeof response.h5_url !== "string") throw fail();
      const url = new URL(response.h5_url);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "wx.tenpay.com" ||
        url.username ||
        url.password
      )
        throw fail();
      return {
        type: "redirect",
        url: `${response.h5_url}&redirect_url=${encodeURIComponent(this.authorization.returnUrl(c, order.id))}`,
      };
    }
    if (
      typeof response.prepay_id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(response.prepay_id)
    )
      throw fail();
    if (mode === "app") {
      const timeStamp = Math.floor(Date.now() / 1000).toString(),
        nonceStr = randomBytes(16).toString("hex"),
        prepayId = response.prepay_id;
      // APP signs raw prepay_id, unlike JSAPI's "prepay_id=…" package.
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(
          `${c.mobileAppId}\n${timeStamp}\n${nonceStr}\n${prepayId}\n`,
        ),
        c.privateKey,
      ).toString("base64");
      return {
        type: "app",
        parameters: {
          appId: c.mobileAppId,
          partnerId: c.merchantId,
          prepayId,
          packageValue: "Sign=WXPay",
          nonceStr,
          timeStamp,
          sign: signature,
        },
      };
    }
    const timeStamp = Math.floor(Date.now() / 1000).toString(),
      nonceStr = randomBytes(16).toString("hex"),
      pkg = `prepay_id=${response.prepay_id}`;
    const paySign = sign(
      "RSA-SHA256",
      Buffer.from(`${c.appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`),
      c.privateKey,
    ).toString("base64");
    return {
      type: "jsapi",
      parameters: {
        appId: c.appId,
        timeStamp,
        nonceStr,
        package: pkg,
        signType: "RSA",
        paySign,
      },
    };
  }
  async close(orderId: string, context?: PaymentContext) {
    const c = await this.config(context);
    await this.request(
      c,
      "POST",
      `/v3/pay/transactions/out-trade-no/${merchantOrder(orderId)}/close`,
      { mchid: c.merchantId },
    );
  }
  async query(orderId: string, context?: PaymentContext) {
    const c = await this.config(context);
    const response = await this.request(
      c,
      "GET",
      `/v3/pay/transactions/out-trade-no/${merchantOrder(orderId)}?mchid=${c.merchantId}`,
    );
    const event = payment(response, c, context?.mode);
    if (event && event.orderId !== orderId) throw fail();
    return event;
  }
  async verify(
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    if (
      raw.length > 64 * 1024 ||
      typeof headers["wechatpay-serial"] !== "string"
    )
      throw fail();
    const keys = await this.configuration.source.query(
      "SELECT id FROM payment_configurations WHERE JSON_UNQUOTE(JSON_EXTRACT(public_json,'$.platformSerial'))=? ORDER BY version DESC",
      [headers["wechatpay-serial"]],
    );
    let authenticated = false;
    for (const row of keys) {
      const c = await this.configuration.runtime(row.id);
      if (!c) continue;
      try {
        verifyWechat(raw, headers, c);
        authenticated = true;
        break;
      } catch {
        continue;
      }
    }
    if (!authenticated)
      throw new ApiError(400, "PAYMENT_SIGNATURE_INVALID", "支付通知验签失败");
    let envelope: {
      event_type?: string;
      resource_type?: string;
      resource: Record<string, unknown>;
    };
    try {
      envelope = JSON.parse(raw.toString("utf8"));
    } catch {
      throw fail();
    }
    if (
      envelope.event_type !== "TRANSACTION.SUCCESS" ||
      envelope.resource_type !== "encrypt-resource"
    )
      throw fail();
    const rows = await this.configuration.source.query(
      "SELECT id FROM payment_configurations ORDER BY version DESC",
    );
    const tried = new Set<string>();
    for (const row of rows) {
      const c = await this.configuration.runtime(row.id);
      if (!c || tried.has(c.apiV3Key)) continue;
      tried.add(c.apiV3Key);
      let data: Record<string, unknown>;
      try {
        data = decryptWechat(envelope.resource, c.apiV3Key);
      } catch {
        continue;
      }
      const orderId = localOrder(data.out_trade_no);
      const [order] = await this.configuration.source.query(
        "SELECT configuration_id,payment_mode FROM payment_orders WHERE id=?",
        [orderId],
      );
      if (!order?.configuration_id) break;
      const bound = await this.configuration.runtime(order.configuration_id);
      // Verification-key rotation is independent of a pending order's merchant identity. API-v3 keys also rotate globally.
      if (!bound || bound.merchantId !== c.merchantId) {
        tried.delete(c.apiV3Key);
        continue;
      }
      const event = payment(data, bound, order.payment_mode ?? "native");
      if (event) return event;
    }
    throw new ApiError(
      400,
      "PAYMENT_SIGNATURE_INVALID",
      "支付通知解密或订单商户校验失败",
    );
  }
}
