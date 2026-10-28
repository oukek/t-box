import type { WechatLoginConfiguration } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { createVault } from '../admin/crypto.js'
import { isIP } from 'node:net'
import { object } from '@t-box/server-foundation/input'
import { ErrorCode } from '../error-codes.js'
import { WechatAccountEntity } from './wechat-entities.js'

export class WechatAccountConfiguration {
  constructor(readonly source: DataSource, readonly vault: ReturnType<typeof createVault>) {}

  async runtime() {
    const row = await this.source.getRepository(WechatAccountEntity).findOne({
      where: { id: 1 },
      select: { id: true, revision: true, enabled: true, appId: true, frontendUrl: true, appSecretCipher: true },
    })
    return row ? { ...row, appSecret: this.vault.decrypt(row.appSecretCipher) } : null
  }

  async view(): Promise<WechatLoginConfiguration> {
    const row = await this.runtime()
    return {
      enabled: row?.enabled ?? false,
      appId: row?.appId ?? '',
      frontendUrl: row?.frontendUrl ?? '',
      hasAppSecret: !!row?.appSecret,
      revision: row?.revision ?? 0,
    }
  }

  async save(value: unknown, administratorId: string) {
    const input = object(value, ['enabled', 'appId', 'appSecret', 'frontendUrl', 'hasAppSecret', 'revision'])
    if (typeof input.enabled !== 'boolean' || typeof input.appId !== 'string' || typeof input.frontendUrl !== 'string' || (input.appSecret !== undefined && typeof input.appSecret !== 'string')) {
      throw ErrorCode.WECHAT_ACCOUNT_INVALID()
    }
    const enabled = input.enabled
    const appId = input.appId.trim()
    const frontendUrl = input.frontendUrl.trim().replace(/\/+$/, '')
    if (appId || enabled) {
      try {
        const url = new URL(frontendUrl)
        if (!/^wx[a-zA-Z0-9]{8,30}$/.test(appId) || frontendUrl.length > 1024 || url.protocol !== 'https:' || url.origin !== frontendUrl || isIP(url.hostname) || !url.hostname.includes('.')) {
          throw ErrorCode.WECHAT_ACCOUNT_INVALID()
        }
      } catch {
        throw ErrorCode.WECHAT_ACCOUNT_INVALID()
      }
    }
    await this.source.transaction(async (db) => {
      await db.createQueryBuilder().insert().into(WechatAccountEntity).values({
        id: 1,
        revision: 0,
        enabled: false,
        appId: '',
        frontendUrl: '',
        appSecretCipher: this.vault.encrypt(''),
      }).orIgnore().execute()
      const old = await db.getRepository(WechatAccountEntity).findOneOrFail({
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
        select: { id: true, revision: true, appId: true, appSecretCipher: true },
      })
      if (input.revision !== old.revision) {
        throw ErrorCode.WECHAT_ACCOUNT_STALE()
      }
      const appSecret = (input.appSecret as string | undefined)?.trim() || (old.appId === appId ? this.vault.decrypt(old.appSecretCipher) : '')
      if ((enabled || appId) && !/^[a-z0-9]{16,128}$/i.test(appSecret)) {
        throw ErrorCode.WECHAT_ACCOUNT_INVALID()
      }
      await db.getRepository(WechatAccountEntity).update({ id: 1 }, {
        enabled,
        appId,
        frontendUrl,
        appSecretCipher: this.vault.encrypt(appSecret),
        revision: old.revision + 1,
        updatedBy: administratorId,
        updatedAt: new Date(),
      })
    })
    return this.view()
  }
}
