import { randomBytes } from "node:crypto";
import { digest } from "../admin/crypto.js";
import { PaymentConfiguration, type WechatRuntime } from "./configuration.js";
import { ApiError } from "@t-box/server-foundation/errors";
export class WechatAuthorization {
  constructor(
    private configuration: PaymentConfiguration,
    private transport: typeof fetch = fetch,
  ) {}
  returnUrl(c: WechatRuntime, id: string, authorized = false) {
    return `${c.frontendUrl}/#/ai/recharge?paymentOrder=${encodeURIComponent(id)}${authorized ? "&wechatAuthorized=1" : ""}`;
  }
  async openid(userId: string, appId: string) {
    const [row] = await this.configuration.source.query(
      "SELECT openid_cipher FROM payment_wechat_users WHERE user_id=? AND app_id=?",
      [userId, appId],
    );
    return row ? this.configuration.vault.decrypt(row.openid_cipher) : null;
  }
  async start(userId: string, orderId: string, c: WechatRuntime) {
    await this.configuration.source.query(
      "DELETE FROM payment_oauth_states WHERE user_id=? AND expires_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)",
      [userId],
    );
    const [pending] = await this.configuration.source.query(
      "SELECT COUNT(*) n FROM payment_oauth_states WHERE user_id=? AND consumed=FALSE AND expires_at>UTC_TIMESTAMP(3)",
      [userId],
    );
    if (Number(pending.n) >= 20)
      throw new ApiError(429, "OAUTH_LIMIT", "授权请求过多，请稍后再试");
    const state = randomBytes(24).toString("hex");
    // Bound to the authenticated local user and order; never accept a client-supplied openid.
    await this.configuration.source.query(
      "INSERT INTO payment_oauth_states(state_hash,user_id,order_id,configuration_id,expires_at) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE))",
      [digest(state), userId, orderId, c.id],
    );
    const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
    url.search = new URLSearchParams({
      appid: c.appId,
      redirect_uri: `${c.apiBaseUrl}/api/v1/payments/wechat/oauth/callback`,
      response_type: "code",
      scope: "snsapi_base",
      state,
    }).toString();
    url.hash = "wechat_redirect";
    return url.href;
  }
  async callback(state: unknown, code: unknown) {
    if (
      typeof state !== "string" ||
      !/^[a-f0-9]{48}$/.test(state) ||
      typeof code !== "string" ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(code)
    )
      throw new ApiError(400, "OAUTH_INVALID", "微信授权参数无效");
    const row = await this.configuration.source.transaction(async (db) => {
      const [r] = await db.query(
        "SELECT * FROM payment_oauth_states WHERE state_hash=? AND consumed=FALSE AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE",
        [digest(state)],
      );
      if (!r)
        throw new ApiError(
          400,
          "OAUTH_EXPIRED",
          "微信授权已过期，请从充值订单重新发起",
        );
      await db.query(
        "UPDATE payment_oauth_states SET consumed=TRUE WHERE state_hash=?",
        [digest(state)],
      );
      return r;
    });
    const bound = await this.configuration.runtime(row.configuration_id);
    const c = bound ? await this.configuration.credentials(bound) : null;
    if (!c?.appSecret)
      throw new ApiError(503, "OAUTH_UNAVAILABLE", "公众号网页授权尚未配置");
    let openid: string;
    try {
      const query = new URLSearchParams({
        appid: c.appId,
        secret: c.appSecret,
        code,
        grant_type: "authorization_code",
      });
      const response = await this.transport(
        `https://api.weixin.qq.com/sns/oauth2/access_token?${query}`,
        { redirect: "error", signal: AbortSignal.timeout(10000) },
      );
      const result = (await response.json()) as {
        openid?: unknown;
        errcode?: number;
      };
      if (
        !response.ok ||
        result.errcode ||
        typeof result.openid !== "string" ||
        !/^[A-Za-z0-9_-]{10,128}$/.test(result.openid)
      )
        throw new Error();
      openid = result.openid;
    } catch {
      throw new ApiError(
        502,
        "OAUTH_FAILED",
        "微信网页授权失败，请重新发起支付",
      );
    }
    await this.configuration.source.query(
      "INSERT INTO payment_wechat_users(user_id,app_id,openid_cipher) VALUES(?,?,?) ON DUPLICATE KEY UPDATE openid_cipher=VALUES(openid_cipher),updated_at=UTC_TIMESTAMP(3)",
      [row.user_id, c.appId, this.configuration.vault.encrypt(openid)],
    );
    return this.returnUrl(c, row.order_id, true);
  }
}
