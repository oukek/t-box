import type { Actor } from '@t-box/app-server-sdk'
import type { WechatCheckoutLink, WechatCheckoutPreview, WechatCheckoutState } from '@t-box/shared'
import type { DataSource, EntityManager } from 'typeorm'
import type { CheckoutLinkRow } from './checkout-link-entity.js'
import type { PaymentConfiguration } from './configuration.js'
import type { PaymentService } from './service.js'
import { randomBytes } from 'node:crypto'
import { object } from '@t-box/server-foundation/input'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { isoTime } from '@t-box/server-foundation/time'
import { MoreThan } from 'typeorm'
import { digest } from '../admin/crypto.js'
import { PaymentOrderEntity } from '../db/records/payments-entities.js'
import { ErrorCode } from '../error-codes.js'
import { UserProfileEntity } from '../identity/profile-entity.js'
import { WechatFlowEntity } from '../identity/wechat-entities.js'
import { qrChanged } from '../realtime/qr-signals.js'
import { CheckoutLinkEntity } from './checkout-link-entity.js'

/** A payment link authorizes this order only, never a login or arbitrary recipient. */
export class WechatCheckoutLinks {
  constructor(private readonly source: DataSource, private readonly payments: PaymentService, private readonly configuration: PaymentConfiguration) {}

  private async authorize(actor: Actor, link: CheckoutLinkRow, ticket: unknown, db = this.source.manager, active = true) {
    if (!link.scanFlowId || typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket) || !await db.getRepository(WechatFlowEntity).existsBy({ id: link.scanFlowId, checkoutTokenHash: digest(ticket), sessionHash: actor.sessionHash, userId: actor.user.id, status: 'complete', ...(active ? { expiresAt: MoreThan(new Date()) } : {}) })) {
      throw ErrorCode.CHECKOUT_WECHAT_AUTH_REQUIRED()
    }
  }

  async create(userId: string, orderId: string): Promise<WechatCheckoutLink> {
    const order = await this.payments.get(userId, orderId)
    if (order.status !== 'pending' || Date.parse(order.expiresAt) <= Date.now()) {
      throw ErrorCode.ORDER_NOT_PAYABLE()
    }
    const row = await this.source.getRepository(PaymentOrderEntity).findOneByOrFail({ id: orderId, user_id: userId })
    const config = await this.configuration.runtime(row.configuration_id ?? undefined)
    if (!config?.jsapi || !config.frontendUrl) {
      throw ErrorCode.OAUTH_UNAVAILABLE('电脑扫码网页支付需要启用微信 JSAPI 支付')
    }
    if (row.payment_mode && row.payment_mode !== 'jsapi') {
      throw ErrorCode.PAYMENT_MODE_LOCKED()
    }
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Math.min(Date.now() + 10 * 60_000, Date.parse(order.expiresAt)))
    await this.source.transaction(async (db) => {
      const locked = await db.getRepository(PaymentOrderEntity).findOne({ where: { id: orderId, user_id: userId }, lock: { mode: 'pessimistic_write' } })
      if (!locked || locked.status !== 'pending' || Date.parse(isoTime(locked.expires_at)) <= Date.now()) {
        throw ErrorCode.ORDER_NOT_PAYABLE()
      }
      if (locked.payment_mode && locked.payment_mode !== 'jsapi') {
        throw ErrorCode.PAYMENT_MODE_LOCKED()
      }
      const previous = await db.getRepository(CheckoutLinkEntity).findOneBy({ orderId })
      if (previous?.payerUserId || (previous?.scanFlowId && previous.stage !== 'cancelled' && (previous.scanExpiresAt?.getTime() ?? 0) > Date.now())) {
        throw ErrorCode.CHECKOUT_LINK_BUSY()
      }
      await db.getRepository(CheckoutLinkEntity).upsert({ orderId, tokenHash: digest(token), expiresAt, payerUserId: null, scanFlowId: null, scanExpiresAt: null, stage: 'waiting' }, ['orderId'])
    })
    qrChanged(this.source, `order:${orderId}`)
    return { url: `${config.frontendUrl}/#/pay/wechat?ticket=${token}`, expiresAt: expiresAt.toISOString() }
  }

  private async link(ticket: unknown, db = this.source.manager, lock = false) {
    if (typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket)) {
      throw ErrorCode.CHECKOUT_LINK_INVALID()
    }
    const row = await db.getRepository(CheckoutLinkEntity).findOne({ where: { tokenHash: digest(ticket) }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) })
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      throw ErrorCode.CHECKOUT_LINK_INVALID()
    }
    return row
  }

  private async orderOwner(orderId: string, db: EntityManager = this.source.manager) {
    const order = await db.getRepository(PaymentOrderEntity).findOneBy({ id: orderId })
    if (!order) {
      throw ErrorCode.ORDER_NOT_FOUND()
    }
    return order.user_id
  }

  async preview(actor: Actor, value: unknown): Promise<WechatCheckoutPreview> {
    const input = object(value, ['ticket'])
    const link = await this.link(input.ticket)
    await this.authorize(actor, link, input.ticket)
    const userId = await this.orderOwner(link.orderId)
    const user = await this.source.getRepository(AppUserEntity).findOneByOrFail({ id: userId })
    const profile = await this.source.getRepository(UserProfileEntity).findOneBy({ userId })
    return {
      order: await this.payments.get(userId, link.orderId),
      recipient: { id: userId, nickname: user.nickname || '方舟', avatarUrl: profile?.avatarUrl || '' },
      sameAccount: actor.user.id === userId,
      payerUnavailable: !!link.payerUserId && link.payerUserId !== actor.user.id,
    }
  }

  async intent(actor: Actor, value: unknown, clientIp: string) {
    const input = object(value, ['ticket', 'confirmedRecipientId'])
    const { link, ownerId } = await this.source.transaction(async (db) => {
      const link = await this.link(input.ticket, db, true)
      await this.authorize(actor, link, input.ticket, db)
      const ownerId = await this.orderOwner(link.orderId, db)
      if (ownerId !== actor.user.id && input.confirmedRecipientId !== ownerId) {
        throw ErrorCode.CHECKOUT_ACCOUNT_MISMATCH()
      }
      if (link.payerUserId && link.payerUserId !== actor.user.id) {
        throw ErrorCode.CHECKOUT_PAYER_CHANGED()
      }
      await db.getRepository(CheckoutLinkEntity).update({ orderId: link.orderId }, { payerUserId: actor.user.id, stage: 'paying' })
      return { link, ownerId }
    })
    qrChanged(this.source, `order:${link.orderId}`)
    return this.payments.intent(ownerId, link.orderId, 'jsapi', clientIp, actor.user.id)
  }

  async jsSdk(actor: Actor, value: unknown) {
    const input = object(value, ['ticket', 'url'])
    const link = await this.link(input.ticket)
    await this.authorize(actor, link, input.ticket)
    if (link.payerUserId !== actor.user.id) {
      throw ErrorCode.CHECKOUT_ACCOUNT_MISMATCH()
    }
    return this.payments.jsapiConfiguration(await this.orderOwner(link.orderId), link.orderId, input.url)
  }

  async refresh(actor: Actor, value: unknown) {
    const input = object(value, ['ticket'])
    const link = await this.link(input.ticket)
    if (link.payerUserId !== actor.user.id) {
      throw ErrorCode.CHECKOUT_ACCOUNT_MISMATCH()
    }
    return this.payments.refresh(await this.orderOwner(link.orderId), link.orderId)
  }

  async cancel(actor: Actor, value: unknown) {
    const input = object(value, ['ticket'])
    const link = await this.source.transaction(async (db) => {
      const link = await this.link(input.ticket, db, true)
      await this.authorize(actor, link, input.ticket, db, false)
      await db.getRepository(CheckoutLinkEntity).update({ orderId: link.orderId }, { stage: 'cancelled' })
      return link
    })
    qrChanged(this.source, `order:${link.orderId}`)
  }

  async state(userId: string, orderId: string, reconcile = false): Promise<WechatCheckoutState> {
    const link = await this.source.getRepository(CheckoutLinkEntity).findOneBy({ orderId })
    const order = reconcile && (!link || link.payerUserId)
      ? await this.payments.refresh(userId, orderId)
      : await this.payments.get(userId, orderId)
    const stage = order.status !== 'pending'
      ? order.status
      : Date.parse(order.expiresAt) <= Date.now() || (link && (link.expiresAt.getTime() <= Date.now() || (link.scanFlowId && !link.payerUserId && (link.scanExpiresAt?.getTime() ?? 0) <= Date.now())))
        ? 'expired'
        : link?.stage ?? 'waiting'
    const expiresAt = new Date(Math.min(Date.parse(order.expiresAt), link?.expiresAt.getTime() ?? Infinity, link?.scanFlowId && !link.payerUserId ? (link.scanExpiresAt?.getTime() ?? Infinity) : Infinity)).toISOString()
    return { order, stage, expiresAt }
  }

  async handoffState(actor: Actor, value: unknown, reconcile = false) {
    const input = object(value, ['ticket'])
    const link = await this.link(input.ticket)
    await this.authorize(actor, link, input.ticket, this.source.manager, false)
    return this.state(await this.orderOwner(link.orderId), link.orderId, reconcile)
  }
}
