import type {
  WechatPaymentConfiguration,
  WechatPaymentSecrets,
} from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { createVault } from '../admin/crypto.js'
import type { ConfigurationCache } from '../configuration/cache.js'
import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from 'node:crypto'
import { isIP } from 'node:net'
import { ApiError } from '@t-box/server-foundation/errors'
import { object } from '@t-box/server-foundation/input'

export type WechatRuntime = WechatPaymentConfiguration &
  Required<WechatPaymentSecrets> & { id: string }
export const emptyWechat: WechatPaymentConfiguration = {
  enabled: false,
  appId: '',
  mobileAppId: '',
  app: false,
  merchantId: '',
  merchantSerial: '',
  platformSerial: '',
  platformPublicKey: '',
  apiBaseUrl: '',
  frontendUrl: '',
  description: 'T Box 服务余额充值',
  native: true,
  h5: false,
  jsapi: false,
}
function https(value: unknown, name: string) {
  try {
    const u = new URL(String(value))
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      isIP(u.hostname) ||
      u.hostname === 'localhost'
    ) {
      throw new Error('Invalid public HTTPS URL')
    }
    return u.href.replace(/\/$/, '')
  } catch {
    throw new ApiError(
      400,
      'INVALID_PAYMENT_CONFIG',
      `${name}须为不带查询参数的公网 HTTPS 地址`,
    )
  }
}
export class PaymentConfiguration {
  constructor(
    readonly source: DataSource,
    readonly vault: ReturnType<typeof createVault>,
    private readonly cache?: ConfigurationCache,
  ) {}

  async runtime(id?: string): Promise<WechatRuntime | null> {
    if (this.cache) {
      if (!id) {
        const [settings] = await this.source.query(
          'SELECT configuration_id FROM payment_settings WHERE id=1',
        )
        if (!settings?.configuration_id) {
          return null
        }
        id = settings.configuration_id
      }
      const row = await this.cache.read('wechat', id!, async () => {
        const [row] = await this.source.query(
          'SELECT * FROM payment_configurations WHERE id=?',
          [id],
        )
        return row ?? null
      })
      return row
        ? {
            ...emptyWechat,
            ...(typeof row.public_json === 'string'
              ? JSON.parse(row.public_json)
              : row.public_json),
            ...JSON.parse(this.vault.decrypt(row.secret_cipher)),
            id: row.id,
          }
        : null
    }
    const [row] = await this.source.query(
      id
        ? 'SELECT * FROM payment_configurations WHERE id=?'
        : 'SELECT c.* FROM payment_settings s JOIN payment_configurations c ON c.id=s.configuration_id WHERE s.id=1',
      id ? [id] : [],
    )
    if (!row) {
      return null
    }
    return {
      ...emptyWechat,
      ...(typeof row.public_json === 'string'
        ? JSON.parse(row.public_json)
        : row.public_json),
      ...JSON.parse(this.vault.decrypt(row.secret_cipher)),
      id: row.id,
    }
  }

  async credentials(bound: WechatRuntime): Promise<WechatRuntime> {
    // Credentials rotate at merchant/account level, while the order keeps its identity.
    const [merchant] = await this.source.query(
      'SELECT id FROM payment_configurations WHERE JSON_UNQUOTE(JSON_EXTRACT(public_json,\'$.merchantId\'))=? ORDER BY version DESC LIMIT 1',
      [bound.merchantId],
    )
    const [account] = await this.source.query(
      'SELECT id FROM payment_configurations WHERE JSON_UNQUOTE(JSON_EXTRACT(public_json,\'$.appId\'))=? ORDER BY version DESC LIMIT 1',
      [bound.appId],
    )
    const signing = merchant ? await this.runtime(merchant.id) : null
    const oauth = account ? await this.runtime(account.id) : null
    return {
      ...bound,
      ...(signing
        ? {
            privateKey: signing.privateKey,
            merchantSerial: signing.merchantSerial,
            platformPublicKey: signing.platformPublicKey,
            platformSerial: signing.platformSerial,
          }
        : {}),
      ...(oauth ? { appSecret: oauth.appSecret } : {}),
    }
  }

  async view(): Promise<WechatPaymentConfiguration> {
    const c = await this.runtime()
    if (!c) {
      return { ...emptyWechat }
    }
    const { privateKey, apiV3Key, appSecret, ...publicFields } = c
    return {
      ...publicFields,
      hasPrivateKey: !!privateKey,
      hasApiV3Key: !!apiV3Key,
      hasAppSecret: !!appSecret,
    }
  }

  async save(value: unknown, administrator: string) {
    const b = object(value, [
      ...Object.keys(emptyWechat),
      'id',
      'hasPrivateKey',
      'hasApiV3Key',
      'hasAppSecret',
      'privateKey',
      'apiV3Key',
      'appSecret',
    ])
    return this.source.transaction(async (db) => {
      await db.query('SELECT id FROM payment_settings WHERE id=1 FOR UPDATE')
      const old = await this.runtime()
      if (old && b.id !== old.id) {
        throw new ApiError(
          409,
          'PAYMENT_CONFIG_STALE',
          '支付配置已修改，请刷新后重试',
        )
      }
      const c = { ...emptyWechat, ...b } as WechatRuntime
      for (const key of ['enabled', 'native', 'h5', 'jsapi', 'app'] as const) {
        if (typeof c[key] !== 'boolean') {
          throw new ApiError(400, 'INVALID_PAYMENT_CONFIG', '支付开关无效')
        }
      }
      for (const key of [
        'appId',
        'mobileAppId',
        'merchantId',
        'merchantSerial',
        'platformSerial',
        'platformPublicKey',
        'description',
      ] as const) {
        if (typeof c[key] !== 'string' || c[key].length > 10000) {
          throw new ApiError(400, 'INVALID_PAYMENT_CONFIG', '支付配置字段无效')
        }
      }
      const secrets = Object.fromEntries(
        (['privateKey', 'apiV3Key', 'appSecret'] as const).map((k) => {
          if (
            b[k] !== undefined &&
            (typeof b[k] !== 'string' || b[k].length > 10000)
          ) {
            throw new ApiError(400, 'INVALID_PAYMENT_CONFIG', '密钥格式无效')
          }
          return [k, (b[k] as string | undefined)?.trim() || old?.[k] || '']
        }),
      ) as Required<WechatPaymentSecrets>
      const supplied = !!c.appId || !!c.mobileAppId || c.enabled
      if (supplied) {
        if (
          ((!!c.appId || c.native || c.h5 || c.jsapi) &&
            !/^wx[a-zA-Z0-9]{8,30}$/.test(c.appId)) ||
            ((!!c.mobileAppId || c.app) &&
              !/^wx[a-zA-Z0-9]{8,30}$/.test(c.mobileAppId)) ||
              !/^\d{6,32}$/.test(c.merchantId) ||
              !/^[A-F0-9]{16,64}$/i.test(c.merchantSerial) ||
              !/^(?:PUB_KEY_ID_\w+|[A-Fa-f0-9]{16,64})$/.test(
                c.platformSerial,
              )
        ) {
          throw new ApiError(
            400,
            'INVALID_PAYMENT_CONFIG',
            'AppID、商户号或证书 / 公钥 ID 格式无效',
          )
        }
        c.apiBaseUrl = https(c.apiBaseUrl, 'API 公网地址')
        if (c.frontendUrl || c.h5 || c.jsapi) {
          c.frontendUrl = https(c.frontendUrl, '支付网页地址')
        }
        if (Buffer.byteLength(secrets.apiV3Key) !== 32) {
          throw new ApiError(
            400,
            'INVALID_PAYMENT_CONFIG',
            'API v3 密钥须为 32 字节',
          )
        }
        if (!c.description.trim() || c.description.length > 127) {
          throw new ApiError(
            400,
            'INVALID_PAYMENT_CONFIG',
            '商品描述须为 1–127 字符',
          )
        }
        try {
          const privateKey = createPrivateKey(secrets.privateKey)
          const platformKey = createPublicKey(c.platformPublicKey)
          if (
            privateKey.asymmetricKeyType !== 'rsa' ||
            platformKey.asymmetricKeyType !== 'rsa' ||
            (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
            (platformKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
          ) {
            throw new Error('Payment keys must use RSA with at least 2048 bits')
          }
          if (
            !verify(
              'RSA-SHA256',
              Buffer.from('config-check'),
              createPublicKey(privateKey),
              sign('RSA-SHA256', Buffer.from('config-check'), privateKey),
            )
          ) {
            throw new Error('Payment private key failed signature verification')
          }
        } catch {
          throw new ApiError(
            400,
            'INVALID_PAYMENT_CONFIG',
            '商户私钥或微信支付公钥 / 平台证书 PEM 无效',
          )
        }
        if (c.jsapi && !/^[A-Z0-9]{16,128}$/i.test(secrets.appSecret)) {
          throw new ApiError(
            400,
            'INVALID_PAYMENT_CONFIG',
            'JSAPI 支付需要公众号 AppSecret',
          )
        }
        if (
          old &&
          (old.appId !== c.appId || old.merchantId !== c.merchantId) &&
          (!b.privateKey || !b.apiV3Key || (c.jsapi && !b.appSecret))
        ) {
          throw new ApiError(
            400,
            'INVALID_PAYMENT_CONFIG',
            '更换商户或公众号时须重新填写全部对应密钥',
          )
        }
      } else if (c.enabled) {
        throw new ApiError(400, 'INVALID_PAYMENT_CONFIG', '请先完成支付配置')
      }
      if (c.enabled && !c.native && !c.h5 && !c.jsapi && !c.app) {
        throw new ApiError(
          400,
          'INVALID_PAYMENT_CONFIG',
          '至少启用一种支付方式',
        )
      }
      const id = randomUUID()
      const pub = Object.fromEntries(
        Object.keys(emptyWechat).map((k) => [k, c[k as keyof WechatRuntime]]),
      )
      await db.query(
        'INSERT INTO payment_configurations(id,public_json,secret_cipher,administrator_id) VALUES(?,?,?,?)',
        [
          id,
          JSON.stringify(pub),
          this.vault.encrypt(JSON.stringify(secrets)),
          administrator,
        ],
      )
      await db.query(
        'UPDATE payment_settings SET configuration_id=? WHERE id=1',
        [id],
      )
      return { ...pub, id }
    })
  }
}
