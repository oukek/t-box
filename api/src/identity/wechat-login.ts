import type { AppUser, UserSession, WechatLoginFlow, WechatLoginResult } from '@t-box/shared'
import type { EntityManager } from 'typeorm'
import type { IdentityService } from './service.js'
import type { WechatAccountConfiguration } from './wechat-configuration.js'
import type { WechatFlowRow } from './wechat-entities.js'
import type { WechatProfile } from './wechat-profile.js'
import { randomBytes, randomUUID } from 'node:crypto'
import { object } from '@t-box/server-foundation/input'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { isoTime } from '@t-box/server-foundation/time'
import { IsNull, LessThan, Raw } from 'typeorm'
import { digest } from '../admin/crypto.js'
import { PaymentWechatUserEntity } from '../db/records/payments-entities.js'
import { ErrorCode } from '../error-codes.js'
import { CheckoutLinkEntity } from '../payments/checkout-link-entity.js'
import { qrChanged } from '../realtime/qr-signals.js'
import { UserProfileEntity } from './profile-entity.js'
import { WechatAccountEntity, WechatFlowEntity, WechatIdentityEntity } from './wechat-entities.js'
import { fetchWechatProfile } from './wechat-profile.js'

const ttl = 5 * 60_000
const selected = { id: true, kind: true, appId: true, parentId: true, device: true, status: true, userId: true, sessionCipher: true, expiresAt: true } as const

function credentials(input: Record<string, unknown>) {
  if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id) || typeof input.secret !== 'string' || !/^[a-f0-9]{64}$/.test(input.secret)) {
    throw ErrorCode.WECHAT_LOGIN_INVALID()
  }
  return { id: input.id, secretHash: digest(input.secret) }
}

export class WechatLoginService {
  constructor(readonly configuration: WechatAccountConfiguration, private readonly identity: IdentityService, private readonly transport: typeof fetch = fetch) {}

  private async account(appId?: string) {
    const account = await this.configuration.runtime()
    if (!account?.enabled || !account.appSecret || (appId && account.appId !== appId)) {
      throw ErrorCode.WECHAT_LOGIN_DISABLED()
    }
    return account
  }

  async start(value: unknown, ip: string, device: string): Promise<WechatLoginFlow> {
    this.identity.limit(`wechat-start:${ip}`, 40)
    const input = object(value, ['kind', 'secret', 'parentId', 'checkoutTicket'])
    const kind = input.kind
    if (typeof kind !== 'string' || !['login', 'qr', 'scan'].includes(kind) || typeof input.secret !== 'string' || !/^[a-f0-9]{64}$/.test(input.secret)) {
      throw ErrorCode.WECHAT_LOGIN_INVALID()
    }
    const secret = input.secret
    const account = await this.account()
    const db = this.configuration.source.manager
    let checkoutTokenHash: string | null = null
    if (input.checkoutTicket !== undefined) {
      if (kind !== 'login' || typeof input.checkoutTicket !== 'string' || !/^[a-f0-9]{64}$/.test(input.checkoutTicket)) {
        throw ErrorCode.CHECKOUT_LINK_INVALID()
      }
      checkoutTokenHash = digest(input.checkoutTicket)
      const link = await db.getRepository(CheckoutLinkEntity).findOneBy({ tokenHash: checkoutTokenHash })
      if (!link || link.expiresAt.getTime() <= Date.now()) {
        throw ErrorCode.CHECKOUT_LINK_INVALID()
      }
    }
    let parentId: string | null = null
    if (kind === 'scan') {
      if (typeof input.parentId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.parentId)) {
        throw ErrorCode.WECHAT_LOGIN_INVALID()
      }
      const parent = await db.getRepository(WechatFlowEntity).findOneBy({ id: input.parentId, kind: 'qr', appId: account.appId })
      this.valid(parent)
      if (parent.status !== 'pending') {
        throw ErrorCode.WECHAT_LOGIN_BUSY()
      }
      parentId = parent.id
    }
    await db.getRepository(WechatFlowEntity).delete({ expiresAt: LessThan(new Date(Date.now() - 24 * 60 * 60_000)) })
    const id = randomUUID()
    const state = kind === 'qr' ? undefined : randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + ttl)
    let checkoutOrderId: string | undefined
    await this.configuration.source.transaction(async (db) => {
      if (checkoutTokenHash) {
        const links = db.getRepository(CheckoutLinkEntity)
        const link = await links.findOne({ where: { tokenHash: checkoutTokenHash }, lock: { mode: 'pessimistic_write' } })
        if (!link || link.expiresAt.getTime() <= Date.now()) {
          throw ErrorCode.CHECKOUT_LINK_INVALID()
        }
        if (link.payerUserId || (link.scanFlowId && link.stage !== 'cancelled' && (link.scanExpiresAt?.getTime() ?? 0) > Date.now())) {
          throw ErrorCode.CHECKOUT_LINK_BUSY()
        }
        checkoutOrderId = link.orderId
        await links.update({ orderId: link.orderId }, { scanFlowId: id, scanExpiresAt: expiresAt, stage: 'scanned' })
      }
      await db.getRepository(WechatFlowEntity).insert({
        id,
        kind: kind as WechatFlowRow['kind'],
        secretHash: digest(secret),
        stateHash: state ? digest(state) : null,
        appId: account.appId,
        parentId,
        device,
        expiresAt,
        checkoutTokenHash,
      })
    })
    if (checkoutOrderId) {
      qrChanged(this.configuration.source, `order:${checkoutOrderId}`)
    }
    const result: WechatLoginFlow = { id, kind: kind as WechatFlowRow['kind'], expiresAt: expiresAt.toISOString() }
    if (kind === 'qr') {
      result.qrUrl = `${account.frontendUrl}/?wechatScan=${id}`
    } else {
      const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize')
      url.search = new URLSearchParams({ appid: account.appId, redirect_uri: `${account.frontendUrl}/`, response_type: 'code', scope: 'snsapi_userinfo', state: state! }).toString()
      url.hash = 'wechat_redirect'
      result.state = state
      result.authorizationUrl = url.href
    }
    return result
  }

  private async changed(row: Pick<WechatFlowRow, 'id' | 'parentId'>, checkoutStage?: 'confirming' | 'cancelled') {
    const source = this.configuration.source
    if (checkoutStage) {
      await source.getRepository(CheckoutLinkEntity).update({ scanFlowId: row.id, payerUserId: IsNull() }, { stage: checkoutStage })
    }
    const checkout = await source.getRepository(CheckoutLinkEntity).findOneBy({ scanFlowId: row.id })
    if (checkout) {
      qrChanged(source, `order:${checkout.orderId}`)
    }
    qrChanged(source, `login:${row.id}`)
    if (row.parentId) {
      qrChanged(source, `login:${row.parentId}`)
    }
  }

  private valid(row: WechatFlowRow | null): asserts row is WechatFlowRow {
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      throw ErrorCode.WECHAT_LOGIN_EXPIRED()
    }
  }

  private async flow(db: EntityManager, input: Record<string, unknown>, lock = false) {
    const row = await db.getRepository(WechatFlowEntity).findOne({ where: credentials(input), select: selected, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) })
    this.valid(row)
    return row
  }

  private async user(db: EntityManager, id: string, _appId: string): Promise<AppUser> {
    const user = await db.getRepository(AppUserEntity).findOneBy({ id, enabled: true })
    if (!user) {
      throw ErrorCode.UNAUTHENTICATED('此账号已停用，请联系管理员')
    }
    const profile = await db.getRepository(UserProfileEntity).findOneBy({ userId: id })
    return { id: user.id, username: user.username, nickname: user.nickname, avatarUrl: profile?.avatarUrl || '', createdAt: isoTime(user.createdAt) }
  }

  private async upsertUser(db: EntityManager, appId: string, profile: WechatProfile) {
    // Serialize first-account creation; no network requests run under this lock.
    const account = await db.getRepository(WechatAccountEntity).findOne({ where: { id: 1 }, lock: { mode: 'pessimistic_write' } })
    if (!account?.enabled || account.appId !== appId) {
      throw ErrorCode.WECHAT_LOGIN_DISABLED()
    }
    const openidHash = digest(profile.openid)
    const mapping = await db.getRepository(WechatIdentityEntity).findOneBy({ appId, openidHash })
    const user = mapping ? await this.user(db, mapping.userId, appId) : await this.identity.createExternal(db, '方舟')
    await db.getRepository(WechatIdentityEntity).upsert({ appId, openidHash, userId: user.id, openidCipher: this.configuration.vault.encrypt(profile.openid), avatarUrl: profile.avatarUrl, updatedAt: new Date() }, ['appId', 'openidHash'])
    // The same service-account OpenID is the JSAPI payer identity.
    await db.getRepository(PaymentWechatUserEntity).upsert({ user_id: user.id, app_id: appId, openid_cipher: this.configuration.vault.encrypt(profile.openid), updated_at: new Date().toISOString().slice(0, 23).replace('T', ' ') }, ['user_id', 'app_id'])
    return { ...user, avatarUrl: user.avatarUrl || '' }
  }

  async exchange(value: unknown): Promise<WechatLoginResult> {
    const input = object(value, ['id', 'secret', 'state', 'code'])
    if (typeof input.state !== 'string' || !/^[a-f0-9]{48}$/.test(input.state) || typeof input.code !== 'string' || !/^[\w-]{1,256}$/.test(input.code)) {
      throw ErrorCode.WECHAT_LOGIN_INVALID()
    }
    const row = await this.configuration.source.transaction(async (db) => {
      const row = await this.flow(db, input, true)
      const stateMatches = await db.getRepository(WechatFlowEntity).existsBy({ id: row.id, stateHash: digest(input.state as string) })
      if (!stateMatches || row.kind === 'qr') {
        throw ErrorCode.WECHAT_LOGIN_INVALID()
      }
      if (['complete', 'scanned'].includes(row.status)) {
        return row
      }
      if (row.status !== 'pending') {
        throw ErrorCode.WECHAT_LOGIN_EXPIRED()
      }
      await db.getRepository(WechatFlowEntity).update({ id: row.id }, { status: 'exchanging' })
      return row
    })
    if (row.status !== 'pending') {
      return this.poll(input)
    }
    try {
      const account = await this.account(row.appId)
      const profile = await fetchWechatProfile(account.appId, account.appSecret, input.code, this.transport)
      await this.configuration.source.transaction(async (db) => {
        const parent = row.parentId ? await db.getRepository(WechatFlowEntity).findOne({ where: { id: row.parentId }, select: selected, lock: { mode: 'pessimistic_write' } }) : null
        const current = await this.flow(db, input, true)
        if (current.status !== 'exchanging') {
          throw ErrorCode.WECHAT_LOGIN_EXPIRED()
        }
        if (row.kind === 'scan') {
          this.valid(parent)
          if (parent.status !== 'pending' || parent.appId !== row.appId) {
            throw ErrorCode.WECHAT_LOGIN_BUSY()
          }
        }
        const user = await this.upsertUser(db, row.appId, profile)
        if (parent) {
          await db.getRepository(WechatFlowEntity).update({ id: parent.id }, { status: 'scanned', userId: user.id })
          await db.getRepository(WechatFlowEntity).update({ id: row.id }, { status: 'scanned', userId: user.id })
        } else {
          const session = await this.identity.session(db, user, row.device)
          await db.getRepository(WechatFlowEntity).update({ id: row.id }, { status: 'complete', userId: user.id, sessionHash: digest(session.token), sessionCipher: this.configuration.vault.encrypt(JSON.stringify(session)) })
        }
      })
    } catch (error) {
      await this.configuration.source.getRepository(WechatFlowEntity).update({ id: row.id, status: 'exchanging' }, { status: 'failed' })
      await this.changed(row, 'cancelled')
      throw error
    }
    await this.changed(row, 'confirming')
    return this.poll(input)
  }

  async poll(value: unknown): Promise<WechatLoginResult> {
    const input = object(value, ['id', 'secret', 'state', 'code'])
    const db = this.configuration.source.manager
    const row = await this.flow(db, input)
    await this.account(row.appId)
    const result: WechatLoginResult = { status: row.status, kind: row.kind }
    if (row.userId && ['scanned', 'complete'].includes(row.status)) {
      result.user = await this.user(db, row.userId, row.appId)
    }
    if (row.parentId) {
      const parent = await db.getRepository(WechatFlowEntity).findOneBy({ id: row.parentId })
      this.valid(parent)
      result.device = parent.device
      if (['complete', 'cancelled'].includes(parent.status)) {
        result.status = parent.status
      }
    } else if (row.status === 'complete' && row.sessionCipher) {
      const session = JSON.parse(this.configuration.vault.decrypt(row.sessionCipher)) as UserSession
      const actor = await this.identity.authenticate(session.token)
      result.session = { ...session, user: actor.user }
    }
    return result
  }

  async confirm(value: unknown) {
    const input = object(value, ['id', 'secret', 'approve'])
    if (typeof input.approve !== 'boolean') {
      throw ErrorCode.WECHAT_LOGIN_INVALID()
    }
    const scanned = await this.flow(this.configuration.source.manager, input)
    if (scanned.kind !== 'scan' || !scanned.parentId) {
      throw ErrorCode.WECHAT_LOGIN_INVALID()
    }
    await this.configuration.source.transaction(async (db) => {
      const parent = await db.getRepository(WechatFlowEntity).findOne({ where: { id: scanned.parentId! }, select: selected, lock: { mode: 'pessimistic_write' } })
      this.valid(parent)
      const scan = await this.flow(db, input, true)
      if (parent.status === 'complete' && scan.status === 'complete' && parent.userId === scan.userId) {
        return
      }
      if (scan.status !== 'scanned' || parent.status !== 'scanned' || !scan.userId || parent.userId !== scan.userId) {
        throw ErrorCode.WECHAT_LOGIN_BUSY()
      }
      let sessionCipher: string | null = null
      if (input.approve) {
        const user = await this.user(db, scan.userId, scan.appId)
        const session = await this.identity.session(db, user, parent.device)
        sessionCipher = this.configuration.vault.encrypt(JSON.stringify(session))
      }
      const status = input.approve ? 'complete' : 'cancelled'
      await db.getRepository(WechatFlowEntity).update({ id: parent.id }, { status, sessionCipher })
      await db.getRepository(WechatFlowEntity).update({ id: scan.id }, { status })
    })
    await this.changed(scanned)
    return this.poll({ id: input.id, secret: input.secret })
  }

  async cancel(value: unknown) {
    const input = object(value, ['id', 'secret'])
    const row = await this.flow(this.configuration.source.manager, input)
    if (row.kind !== 'qr') {
      throw ErrorCode.WECHAT_LOGIN_INVALID()
    }
    await this.configuration.source.getRepository(WechatFlowEntity).update({ id: row.id, status: Raw((column) => `${column} IN ('pending','scanned')`) }, { status: 'cancelled', sessionCipher: null })
    await this.changed(row)
  }
}
