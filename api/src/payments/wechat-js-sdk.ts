import type { WechatJsSdkConfiguration } from '@t-box/shared'
import type { WechatRuntime } from './configuration.js'
import { createHash, randomBytes } from 'node:crypto'
import { ErrorCode } from '../error-codes.js'

export function wechatPageUrl(value: unknown, frontendUrl: string) {
  try {
    if (typeof value !== 'string' || value.length > 4096) {
      throw ErrorCode.INVALID_PAYMENT_CONFIG()
    }
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.origin !== new URL(frontendUrl).origin || url.username || url.password || url.hash) {
      throw ErrorCode.INVALID_PAYMENT_CONFIG()
    }
    return url.href
  } catch {
    throw ErrorCode.INVALID_PAYMENT_CONFIG('支付页面地址须属于已配置的前端网站，且不含 # 路由')
  }
}

export function signWechatPage(ticket: string, url: string, timestamp: number, nonceStr: string) {
  return createHash('sha1').update(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`).digest('hex')
}

/** Coalesced, process-local ticket cache; Redis is not a payment dependency. */
export class WechatJsSdk {
  private readonly tickets = new Map<string, { ticket: string, expiresAt: number }>()
  private readonly pending = new Map<string, Promise<string>>()
  constructor(private readonly transport: typeof fetch = fetch) {}

  private async ticket(c: WechatRuntime) {
    const key = createHash('sha256').update(`${c.appId}:${c.appSecret}`).digest('hex')
    const cached = this.tickets.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ticket
    }
    const existing = this.pending.get(key)
    if (existing) {
      return existing
    }
    const pending = (async () => {
      try {
        const response = await this.transport('https://api.weixin.qq.com/cgi-bin/stable_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant_type: 'client_credential', appid: c.appId, secret: c.appSecret, force_refresh: false }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        })
        const token = await response.json() as { access_token?: string, errcode?: number }
        if (!response.ok || token.errcode || !token.access_token) {
          throw ErrorCode.OAUTH_UNAVAILABLE()
        }
        const query = new URLSearchParams({ access_token: token.access_token, type: 'jsapi' })
        const result = await this.transport(`https://api.weixin.qq.com/cgi-bin/ticket/getticket?${query}`, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
        const data = await result.json() as { ticket?: string, expires_in?: number, errcode?: number }
        if (!result.ok || data.errcode || !data.ticket || !Number.isFinite(data.expires_in) || Number(data.expires_in) <= 300) {
          throw ErrorCode.OAUTH_UNAVAILABLE()
        }
        if (this.tickets.size >= 20) {
          this.tickets.clear()
        }
        this.tickets.set(key, { ticket: data.ticket, expiresAt: Date.now() + (Math.min(Number(data.expires_in), 7200) - 300) * 1000 })
        return data.ticket
      } catch {
        throw ErrorCode.OAUTH_UNAVAILABLE('微信 JS-SDK 初始化失败，请检查公众号 AppSecret、接口 IP 白名单及 JS 接口权限')
      }
    })()
    this.pending.set(key, pending)
    try {
      return await pending
    } finally {
      this.pending.delete(key)
    }
  }

  async configuration(c: WechatRuntime, value: unknown): Promise<WechatJsSdkConfiguration> {
    if (!c.jsapi || !c.appSecret) {
      throw ErrorCode.OAUTH_UNAVAILABLE()
    }
    const url = wechatPageUrl(value, c.frontendUrl)
    const ticket = await this.ticket(c)
    const timestamp = Math.floor(Date.now() / 1000)
    const nonceStr = randomBytes(16).toString('hex')
    return { appId: c.appId, timestamp, nonceStr, signature: signWechatPage(ticket, url, timestamp, nonceStr) }
  }
}
