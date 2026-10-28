import { ErrorCode } from '../error-codes.js'

export interface WechatProfile {
  openid: string
  nickname: string
  avatarUrl: string
}

export function wechatAvatar(value: unknown) {
  if (!value) {
    return ''
  }
  try {
    const url = new URL(String(value))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 2048 || !['qlogo.cn', 'qpic.cn'].some((domain) => url.hostname.endsWith(`.${domain}`))) {
      return ''
    }
    url.protocol = 'https:'
    return url.href
  } catch {
    return ''
  }
}

async function oauthToken(appId: string, appSecret: string, code: string, transport: typeof fetch) {
  const query = new URLSearchParams({ appid: appId, secret: appSecret, code, grant_type: 'authorization_code' })
  const response = await transport(`https://api.weixin.qq.com/sns/oauth2/access_token?${query}`, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
  const token = await response.json() as { access_token?: string, openid?: string, scope?: string, errcode?: number }
  if (!response.ok || token.errcode || !token.access_token || typeof token.openid !== 'string' || !/^[\w-]{10,128}$/.test(token.openid)) {
    throw ErrorCode.WECHAT_LOGIN_FAILED()
  }
  return { ...token, openid: token.openid, access_token: token.access_token }
}

/** Silent authorization identifies the WeChat account without requesting a profile. */
export async function fetchWechatOpenid(appId: string, appSecret: string, code: string, transport: typeof fetch = fetch): Promise<string> {
  try {
    const token = await oauthToken(appId, appSecret, code, transport)
    if (!token.scope?.split(',').some((scope) => ['snsapi_base', 'snsapi_userinfo'].includes(scope))) {
      throw ErrorCode.WECHAT_LOGIN_FAILED()
    }
    return token.openid
  } catch {
    throw ErrorCode.WECHAT_LOGIN_FAILED()
  }
}

/** Only OAuth userinfo tokens can obtain the user's authorized profile. */
export async function fetchWechatProfile(appId: string, appSecret: string, code: string, transport: typeof fetch = fetch): Promise<WechatProfile> {
  try {
    const token = await oauthToken(appId, appSecret, code, transport)
    if (!token.scope?.split(',').includes('snsapi_userinfo')) {
      throw ErrorCode.WECHAT_LOGIN_FAILED()
    }
    const profileQuery = new URLSearchParams({ access_token: token.access_token, openid: token.openid, lang: 'zh_CN' })
    const profileResponse = await transport(`https://api.weixin.qq.com/sns/userinfo?${profileQuery}`, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
    const profile = await profileResponse.json() as { openid?: string, nickname?: string, headimgurl?: string, errcode?: number }
    if (!profileResponse.ok || profile.errcode || profile.openid !== token.openid || typeof profile.nickname !== 'string' || !profile.nickname.trim()) {
      throw ErrorCode.WECHAT_LOGIN_FAILED()
    }
    return { openid: token.openid, nickname: [...profile.nickname.trim()].slice(0, 40).join(''), avatarUrl: wechatAvatar(profile.headimgurl) }
  } catch {
    // Never expose a provider response or URL containing AppSecret/access_token.
    throw ErrorCode.WECHAT_LOGIN_FAILED()
  }
}
