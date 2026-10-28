import type {
  WechatPaymentConfiguration,
  WechatPaymentSecrets,
} from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { createVault } from '../admin/crypto.js'
import type { ConfigurationCache } from '../configuration/cache.js'
import type { WechatAccountConfiguration } from '../identity/wechat-configuration.js'
import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from 'node:crypto'
import { isIP } from 'node:net'
import { object } from '@t-box/server-foundation/input'
import {
  PaymentConfigurationEntity,
  PaymentSettingEntity,
} from '../db/records/payments-entities.js'
import { ErrorCode } from '../error-codes.js'

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
  description: 'T方舟 服务余额充值',
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
      throw ErrorCode.INTERNAL_INVALID_PUBLIC_HTTPS_URL()
    }
    return u.href.replace(/\/$/, '')
  } catch {
    throw ErrorCode.INVALID_PAYMENT_CONFIG(
      `${name}须为不带查询参数的公网 HTTPS 地址`,
    )
  }
}
export class PaymentConfiguration {
  constructor(
    readonly source: DataSource,
    readonly vault: ReturnType<typeof createVault>,
    private readonly cache?: ConfigurationCache,
    private readonly account?: WechatAccountConfiguration,
  ) {}

  private async officialSecret(appId: string, fallback: string) {
    const account = await this.account?.runtime()
    return account?.appId === appId && account.appSecret ? account.appSecret : fallback
  }

  async runtime(id?: string): Promise<WechatRuntime | null> {
    if (this.cache) {
      if (!id) {
        const settings = await this.source
          .getRepository(PaymentSettingEntity)
          .findOne({
            select: { id: true, configuration_id: true },
            where: { id: 1 },
          })
        if (!settings?.configuration_id) {
          return null
        }
        id = settings.configuration_id
      }
      const row = await this.cache.read('wechat', id!, async () => {
        const row = await this.source
          .getRepository(PaymentConfigurationEntity)
          .findOne({
            select: {
              id: true,
              public_json: true,
              secret_cipher: true,
            },
            where: { id },
          })
        return row ?? null
      })
      const runtime = row
        ? {
            ...emptyWechat,
            ...(typeof row.public_json === 'string'
              ? JSON.parse(row.public_json)
              : row.public_json),
            ...JSON.parse(this.vault.decrypt(row.secret_cipher)),
            id: row.id,
          }
        : null
      if (runtime) {
        runtime.appSecret = await this.officialSecret(runtime.appId, runtime.appSecret)
      }
      return runtime
    }
    const query = this.source
      .createQueryBuilder()
      .select('c.id,c.public_json,c.secret_cipher')
      .from('payment_configurations', 'c')
    if (id) {
      query.where('c.id=:id', { id })
    } else {
      query
        .innerJoin('payment_settings', 's', 'c.id=s.configuration_id')
        .where('s.id=1')
    }
    const row = await query.getRawOne()
    if (!row) {
      return null
    }
    const runtime: WechatRuntime = {
      ...emptyWechat,
      ...(typeof row.public_json === 'string'
        ? JSON.parse(row.public_json)
        : row.public_json),
      ...JSON.parse(this.vault.decrypt(row.secret_cipher)),
      id: row.id,
    }
    runtime.appSecret = await this.officialSecret(runtime.appId, runtime.appSecret)
    return runtime
  }

  async credentials(bound: WechatRuntime): Promise<WechatRuntime> {
    // Credentials rotate at merchant/account level, while the order keeps its identity.
    const [merchant] = await this.source
      .createQueryBuilder()
      .select('id')
      .from('payment_configurations', 'payment_configurations')
      .where('JSON_UNQUOTE(JSON_EXTRACT(public_json,\'$.merchantId\'))=:p0')
      .orderBy('version', 'DESC')
      .limit(1)
      .setParameters({ p0: bound.merchantId })
      .getRawMany()
    const [account] = await this.source
      .createQueryBuilder()
      .select('id')
      .from('payment_configurations', 'payment_configurations')
      .where('JSON_UNQUOTE(JSON_EXTRACT(public_json,\'$.appId\'))=:p0')
      .orderBy('version', 'DESC')
      .limit(1)
      .setParameters({ p0: bound.appId })
      .getRawMany()
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
      await db.getRepository(PaymentSettingEntity).find({
        select: { id: true },
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      })
      const old = await this.runtime()
      if (old && b.id !== old.id) {
        throw ErrorCode.PAYMENT_CONFIG_STALE()
      }
      const c = { ...emptyWechat, ...b } as WechatRuntime
      for (const key of ['enabled', 'native', 'h5', 'jsapi', 'app'] as const) {
        if (typeof c[key] !== 'boolean') {
          throw ErrorCode.INVALID_PAYMENT_CONFIG()
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
          throw ErrorCode.INVALID_PAYMENT_CONFIG('支付配置字段无效')
        }
      }
      const secrets = Object.fromEntries(
        (['privateKey', 'apiV3Key', 'appSecret'] as const).map((k) => {
          if (
            b[k] !== undefined &&
            (typeof b[k] !== 'string' || b[k].length > 10000)
          ) {
            throw ErrorCode.INVALID_PAYMENT_CONFIG('密钥格式无效')
          }
          return [k, (b[k] as string | undefined)?.trim() || old?.[k] || '']
        }),
      ) as Required<WechatPaymentSecrets>
      const account = await this.account?.runtime()
      if (c.jsapi && account?.appId && account.appId !== c.appId) {
        throw ErrorCode.INVALID_PAYMENT_CONFIG('JSAPI 支付的服务号 AppID 必须与“微信登录”中的 AppID 一致')
      }
      secrets.appSecret = await this.officialSecret(c.appId, secrets.appSecret)
      const supplied = !!c.appId || !!c.mobileAppId || c.enabled
      if (supplied) {
        if (
          ((!!c.appId || c.native || c.h5 || c.jsapi) &&
            !/^wx[a-zA-Z0-9]{8,30}$/.test(c.appId)) ||
            ((!!c.mobileAppId || c.app) &&
              !/^wx[a-zA-Z0-9]{8,30}$/.test(c.mobileAppId)) ||
              !/^\d{6,32}$/.test(c.merchantId) ||
              !/^[A-F0-9]{16,64}$/i.test(c.merchantSerial) ||
              !/^(?:PUB_KEY_ID_\w+|[A-Fa-f0-9]{16,64})$/.test(c.platformSerial)
        ) {
          throw ErrorCode.INVALID_PAYMENT_CONFIG(
            'AppID、商户号或证书 / 公钥 ID 格式无效',
          )
        }
        c.apiBaseUrl = https(c.apiBaseUrl, 'API 公网地址')
        if (c.frontendUrl || c.h5 || c.jsapi) {
          c.frontendUrl = https(c.frontendUrl, '支付网页地址')
        }
        if (Buffer.byteLength(secrets.apiV3Key) !== 32) {
          throw ErrorCode.INVALID_PAYMENT_CONFIG('API v3 密钥须为 32 字节')
        }
        if (!c.description.trim() || c.description.length > 127) {
          throw ErrorCode.INVALID_PAYMENT_CONFIG('商品描述须为 1–127 字符')
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
            throw ErrorCode.INTERNAL_PAYMENT_KEYS_MUST_USE_RSA_WITH_AT_LEAST_2048_BITS()
          }
          if (
            !verify(
              'RSA-SHA256',
              Buffer.from('config-check'),
              createPublicKey(privateKey),
              sign('RSA-SHA256', Buffer.from('config-check'), privateKey),
            )
          ) {
            throw ErrorCode.INTERNAL_PAYMENT_PRIVATE_KEY_FAILED_SIGNATURE_VERIFICATION()
          }
        } catch {
          throw ErrorCode.INVALID_PAYMENT_CONFIG(
            '商户私钥或微信支付公钥 / 平台证书 PEM 无效',
          )
        }
        if (c.jsapi && !/^[A-Z0-9]{16,128}$/i.test(secrets.appSecret)) {
          throw ErrorCode.INVALID_PAYMENT_CONFIG(
            'JSAPI 支付需要公众号 AppSecret',
          )
        }
        if (
          old &&
          (old.appId !== c.appId || old.merchantId !== c.merchantId) &&
          (!b.privateKey || !b.apiV3Key || (c.jsapi && !b.appSecret))
        ) {
          throw ErrorCode.INVALID_PAYMENT_CONFIG(
            '更换商户或公众号时须重新填写全部对应密钥',
          )
        }
      } else if (c.enabled) {
        throw ErrorCode.INVALID_PAYMENT_CONFIG('请先完成支付配置')
      }
      if (c.enabled && !c.native && !c.h5 && !c.jsapi && !c.app) {
        throw ErrorCode.INVALID_PAYMENT_CONFIG('至少启用一种支付方式')
      }
      const id = randomUUID()
      const pub = Object.fromEntries(
        Object.keys(emptyWechat).map((k) => [k, c[k as keyof WechatRuntime]]),
      )
      await db.getRepository(PaymentConfigurationEntity).insert({
        id,
        public_json: pub,
        secret_cipher: this.vault.encrypt(JSON.stringify(secrets)),
        administrator_id: administrator,
      })
      await db
        .getRepository(PaymentSettingEntity)
        .update({ id: 1 }, { configuration_id: id })
      return { ...pub, id }
    })
  }
}
