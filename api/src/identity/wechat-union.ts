import type { EntityManager } from 'typeorm'
import { EntitySchema } from 'typeorm'
import { digest } from '../admin/crypto.js'
import { ErrorCode } from '../error-codes.js'
import { WechatIdentityEntity } from './wechat-entities.js'

export const WechatUnionIdentity = new EntitySchema<{ appId: string, openidHash: string, unionidHash: string, unionidCipher: string }>({
  name: 'WechatUnionIdentity',
  tableName: 'wechat_union_identities',
  columns: {
    appId: { type: 'varchar', length: 64, name: 'app_id', primary: true },
    openidHash: { type: 'char', length: 64, name: 'openid_hash', primary: true },
    unionidHash: { type: 'char', length: 64, name: 'unionid_hash' },
    unionidCipher: { type: 'text', name: 'unionid_cipher', select: false },
  },
})
export const wechatUnionExtension = {
  id: '2026-11-26-wechat-union-identities',
  tables: [`CREATE TABLE wechat_union_identities (
    app_id varchar(64) NOT NULL,
    openid_hash char(64) NOT NULL,
    unionid_hash char(64) NOT NULL,
    unionid_cipher text NOT NULL,
    PRIMARY KEY(app_id,openid_hash),
    UNIQUE KEY wechat_union_per_app(app_id,unionid_hash),
    KEY wechat_union_lookup(unionid_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
}

/** Caller holds the account configuration write lock through identity creation and session issuance. */
export async function resolveWechatUser(db: EntityManager, appId: string, openidHash: string, unionid: string | undefined, encrypt: (value: string) => string) {
  const keys = { appId, openidHash }
  const identities = db.getRepository(WechatIdentityEntity)
  const mapping = await identities.findOneBy(keys)
  const unions = db.getRepository(WechatUnionIdentity)
  const known = await unions.findOneBy(keys)
  const hash = unionid ? digest(unionid) : known?.unionidHash
  if (!hash) {
    return mapping?.userId
  }
  const conflict = () => ErrorCode.WECHAT_LOGIN_FAILED('微信身份关联冲突，请联系运营者核对账号')
  if (known && known.unionidHash !== hash) {
    throw conflict()
  }
  const sameApp = await unions.findOneBy({ appId, unionidHash: hash })
  if (sameApp && sameApp.openidHash !== openidHash) {
    throw conflict()
  }
  const owners = await unions.createQueryBuilder('link')
    .innerJoin('wechat_identities', 'wx', 'wx.app_id=link.app_id AND wx.openid_hash=link.openid_hash')
    .select('DISTINCT wx.user_id', 'userId')
    .where('link.unionid_hash=:hash', { hash })
    .getRawMany<{ userId: string }>()
  const owner = owners[0]?.userId
  if (owners.length > 1 || (owner && mapping && owner !== mapping.userId)) {
    throw conflict()
  }
  if (owner && !mapping && await identities.existsBy({ appId, userId: owner })) {
    throw conflict()
  }
  if (!known && unionid) {
    await unions.insert({ ...keys, unionidHash: hash, unionidCipher: encrypt(unionid) })
  }
  return mapping?.userId ?? owner
}
