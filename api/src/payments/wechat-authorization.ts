import type { PaymentConfiguration, WechatRuntime } from './configuration.js'
import { randomBytes } from 'node:crypto'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { Raw } from 'typeorm'
import { digest } from '../admin/crypto.js'
import {
  PaymentOauthStateEntity,
  PaymentWechatUserEntity,
} from '../db/records/payments-entities.js'
import { ErrorCode } from '../error-codes.js'

export class WechatAuthorization {
  constructor(
    private configuration: PaymentConfiguration,
    private transport: typeof fetch = fetch,
  ) {}

  returnUrl(c: WechatRuntime, id: string, authorized = false) {
    return `${c.frontendUrl}/#/ai/recharge?paymentOrder=${encodeURIComponent(id)}${authorized ? '&wechatAuthorized=1' : ''}`
  }

  async openid(userId: string, appId: string) {
    const row = await this.configuration.source
      .getRepository(PaymentWechatUserEntity)
      .findOne({
        select: { openid_cipher: true },
        where: { user_id: userId, app_id: appId },
      })
    return row ? this.configuration.vault.decrypt(row.openid_cipher) : null
  }

  async start(userId: string, orderId: string, c: WechatRuntime) {
    const state = randomBytes(24).toString('hex')
    await this.configuration.source.transaction(async (db) => {
      // Serialize quota checks for the same user; external OAuth starts after commit.
      const user = await db.getRepository(AppUserEntity).findOne({
        select: { id: true },
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!user) {
        throw ErrorCode.OAUTH_INVALID()
      }
      await db.getRepository(PaymentOauthStateEntity).delete({
        user_id: userId,
        expires_at: Raw(
          (column) => `${column} < DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)`,
        ),
      })
      const pending = await db.getRepository(PaymentOauthStateEntity).count({
        where: {
          user_id: userId,
          consumed: false,
          expires_at: Raw((column) => `${column} > UTC_TIMESTAMP(3)`),
        },
      })
      if (pending >= 20) {
        throw ErrorCode.OAUTH_LIMIT()
      }
      // Bound to the authenticated local user and order; never accept a client-supplied openid.
      await db.getRepository(PaymentOauthStateEntity).insert({
        state_hash: digest(state),
        user_id: userId,
        order_id: orderId,
        configuration_id: c.id,
        expires_at: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)',
      })
    })
    const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize')
    url.search = new URLSearchParams({
      appid: c.appId,
      redirect_uri: `${c.apiBaseUrl}/api/v1/payments/wechat/oauth/callback`,
      response_type: 'code',
      scope: 'snsapi_base',
      state,
    }).toString()
    url.hash = 'wechat_redirect'
    return url.href
  }

  async callback(state: unknown, code: unknown) {
    if (
      typeof state !== 'string' ||
      !/^[a-f0-9]{48}$/.test(state) ||
      typeof code !== 'string' ||
      !/^[\w-]{1,256}$/.test(code)
    ) {
      throw ErrorCode.OAUTH_INVALID()
    }
    const row = await this.configuration.source.transaction(async (db) => {
      const r = await db.getRepository(PaymentOauthStateEntity).findOne({
        select: {
          state_hash: true,
          user_id: true,
          order_id: true,
          configuration_id: true,
          consumed: true,
          expires_at: true,
        },
        where: {
          state_hash: digest(state),
          consumed: false,
          expires_at: Raw((column) => `${column} > UTC_TIMESTAMP(3)`),
        },
        lock: { mode: 'pessimistic_write' },
      })
      if (!r) {
        throw ErrorCode.OAUTH_EXPIRED()
      }
      await db
        .getRepository(PaymentOauthStateEntity)
        .update({ state_hash: digest(state) }, { consumed: true })
      return r
    })
    const bound = await this.configuration.runtime(row.configuration_id)
    const c = bound ? await this.configuration.credentials(bound) : null
    if (!c?.appSecret) {
      throw ErrorCode.OAUTH_UNAVAILABLE()
    }
    let openid: string
    try {
      const query = new URLSearchParams({
        appid: c.appId,
        secret: c.appSecret,
        code,
        grant_type: 'authorization_code',
      })
      const response = await this.transport(
        `https://api.weixin.qq.com/sns/oauth2/access_token?${query}`,
        { redirect: 'error', signal: AbortSignal.timeout(10000) },
      )
      const result = (await response.json()) as {
        openid?: unknown
        errcode?: number
      }
      if (
        !response.ok ||
        result.errcode ||
        typeof result.openid !== 'string' ||
        !/^[\w-]{10,128}$/.test(result.openid)
      ) {
        throw ErrorCode.INTERNAL_INVALID_WECHAT_OAUTH_RESPONSE()
      }
      openid = result.openid
    } catch {
      throw ErrorCode.OAUTH_FAILED()
    }
    await this.configuration.source
      .createQueryBuilder()
      .insert()
      .into('payment_wechat_users')
      .values({
        user_id: () => ':p0',
        app_id: () => ':p1',
        openid_cipher: () => ':p2',
        updated_at: () => 'UTC_TIMESTAMP(3)',
      })
      .updateEntity(false)
      .setParameters({
        p0: row.user_id,
        p1: c.appId,
        p2: this.configuration.vault.encrypt(openid),
      })
      .orUpdate(['openid_cipher', 'updated_at'])
      .execute()
    return this.returnUrl(c, row.order_id, true)
  }
}
