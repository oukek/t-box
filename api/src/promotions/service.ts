import type { PromotionChannel, PromotionCreativeSettings, PromotionLink, PromotionMetrics } from '@t-box/shared'
import type { DataSource, EntityManager } from 'typeorm'
import type { WechatAccountConfiguration } from '../identity/wechat-configuration.js'
import { randomBytes, randomUUID } from 'node:crypto'
import { object } from '@t-box/server-foundation/input'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { isoTime } from '@t-box/server-foundation/time'
import { In, Like } from 'typeorm'
import { PaymentOrderEntity, PaymentRefundEntity } from '../db/records/payments-entities.js'
import { ErrorCode } from '../error-codes.js'
import { WechatAccountEntity } from '../identity/wechat-entities.js'
import { WechatJsSdk } from '../payments/wechat-js-sdk.js'
import { PromotionCreativeService } from './creatives.js'
import { PromotionFlowEntity, PromotionRegistrationEntity, PromotionSourceEntity } from './entities.js'

export const emptyPromotionMetrics = (): PromotionMetrics => ({
  registrations: 0,
  payingUsers: 0,
  paidAmount: '0.00',
  refundedAmount: '0.00',
  netAmount: '0.00',
})
export const validPromotionToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)

function currency(cents: bigint) {
  return String(cents / 100n) + '.' + (cents % 100n).toString().padStart(2, '0')
}

export class PromotionService {
  private readonly sdk = new WechatJsSdk()
  constructor(readonly source: DataSource, private readonly account?: WechatAccountConfiguration, readonly creatives = new PromotionCreativeService(source)) {}

  private async frontendUrl() {
    const row = await this.source.getRepository(WechatAccountEntity).findOneBy({ id: 1 })
    if (!row?.frontendUrl) {
      throw ErrorCode.PROMOTION_CONFIGURATION_REQUIRED()
    }
    return row.frontendUrl
  }

  async link(row: { id: string, token: string, name: string }, settings?: PromotionCreativeSettings): Promise<PromotionLink> {
    const creative = settings ?? await this.creatives.read()
    const url = new URL('/', await this.frontendUrl())
    url.searchParams.set('ref', row.token)
    return {
      id: row.id,
      token: row.token,
      name: row.name,
      shareUrl: url.href,
      posterPath: '/promotions/' + row.token + '/poster.png?v=' + creative.revision,
      thumbnailPath: '/promotions/thumbnail.jpg?v=' + creative.revision,
      title: creative.title,
      description: creative.description,
    }
  }

  async findToken(token: unknown, enabled = true, db = this.source.manager) {
    if (!validPromotionToken(token)) {
      return null
    }
    const row = await db.getRepository(PromotionSourceEntity).findOneBy({ token, ...(enabled ? { enabled: true } : {}) })
    if (row?.ownerUserId && !await db.getRepository(AppUserEntity).existsBy({ id: row.ownerUserId, enabled: true })) {
      return null
    }
    return row
  }

  /** The QR parent controls attribution on desktop; the scanning device cannot replace it. */
  async bindFlow(db: EntityManager, flowId: string, token: unknown, parentId: string | null) {
    const parent = parentId ? await db.getRepository(PromotionFlowEntity).findOneBy({ flowId: parentId }) : null
    const source = parentId
      ? parent ? await db.getRepository(PromotionSourceEntity).findOneBy({ id: parent.sourceId, enabled: true }) : null
      : await this.findToken(token, true, db)
    if (source) {
      await db.getRepository(PromotionFlowEntity).insert({ flowId, sourceId: source.id })
    }
  }

  /** Called ONLY in the branch creating a brand-new identity, within that transaction. */
  async registerNewUser(db: EntityManager, userId: string, flowId: string) {
    const flow = await db.getRepository(PromotionFlowEntity).findOneBy({ flowId })
    if (!flow) {
      return
    }
    const source = await db.getRepository(PromotionSourceEntity).findOneBy({ id: flow.sourceId, enabled: true })
    if (!source || source.ownerUserId === userId || (source.ownerUserId && !await db.getRepository(AppUserEntity).existsBy({ id: source.ownerUserId, enabled: true }))) {
      return
    }
    await db.getRepository(PromotionRegistrationEntity).insert({ userId, sourceId: source.id })
  }

  async personal(userId: string): Promise<PromotionLink> {
    const user = await this.source.getRepository(AppUserEntity).findOneBy({ id: userId, enabled: true })
    if (!user) {
      throw ErrorCode.UNAUTHENTICATED()
    }
    await this.frontendUrl()
    // The unique owner key makes concurrent requests return the same durable public code.
    await this.source.createQueryBuilder().insert().into(PromotionSourceEntity).values({
      id: randomUUID(),
      token: randomBytes(16).toString('hex'),
      kind: 'user',
      ownerUserId: userId,
      name: '个人分享',
      descriptionNote: '',
      enabled: true,
      revision: 1,
    }).orIgnore().execute()
    const row = await this.source.getRepository(PromotionSourceEntity).findOneByOrFail({ ownerUserId: userId })
    return this.link(row)
  }

  async saveChannel(value: unknown, id?: string) {
    const input = object(value, ['name', 'descriptionNote', 'enabled', 'revision'])
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80 ||
      typeof input.descriptionNote !== 'string' || input.descriptionNote.trim().length > 300 ||
      typeof input.enabled !== 'boolean' || (id && (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1))) {
      throw ErrorCode.PROMOTION_INVALID()
    }
    await this.frontendUrl()
    const fields = { name: input.name.trim(), descriptionNote: input.descriptionNote.trim(), enabled: input.enabled }
    if (id) {
      const result = await this.source.getRepository(PromotionSourceEntity).update({ id, kind: 'channel', revision: Number(input.revision) }, { ...fields, revision: Number(input.revision) + 1 })
      if (!result.affected) {
        throw ErrorCode.PROMOTION_STALE()
      }
    } else {
      id = randomUUID()
      await this.source.getRepository(PromotionSourceEntity).insert({
        id,
        token: randomBytes(16).toString('hex'),
        kind: 'channel',
        ownerUserId: null,
        revision: 1,
        ...fields,
      })
    }
    const row = await this.source.getRepository(PromotionSourceEntity).findOneByOrFail({ id, kind: 'channel' })
    const metrics = await this.metrics([row.id])
    return { ...await this.link(row), ...metrics.get(row.id)!, descriptionNote: row.descriptionNote, enabled: row.enabled, revision: row.revision, createdAt: isoTime(row.createdAt) } satisfies PromotionChannel
  }

  async channels(value: unknown): Promise<{ items: PromotionChannel[], total: number, page: number }> {
    const input = object(value, ['search', 'page'])
    const search = input.search === undefined ? '' : input.search
    const page = input.page === undefined ? 1 : Number(input.page)
    if (typeof search !== 'string' || search.length > 80 || !Number.isSafeInteger(page) || page < 1 || page > 100000) {
      throw ErrorCode.PROMOTION_INVALID()
    }
    const [rows, total] = await this.source.getRepository(PromotionSourceEntity).findAndCount({
      where: { kind: 'channel', ...(search.trim() ? { name: Like('%' + search.trim() + '%') } : {}) },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * 50,
      take: 50,
    })
    const metrics = await this.metrics(rows.map((row) => row.id))
    const creative = await this.creatives.read()
    const items = await Promise.all(rows.map(async (row) => ({
      ...await this.link(row, creative),
      ...metrics.get(row.id)!,
      descriptionNote: row.descriptionNote,
      enabled: row.enabled,
      revision: row.revision,
      createdAt: isoTime(row.createdAt),
    })))
    return { items, total, page }
  }

  async forUsers(userIds: string[]) {
    const rows = userIds.length ? await this.source.getRepository(PromotionSourceEntity).findBy({ kind: 'user', ownerUserId: In(userIds) }) : []
    const metrics = await this.metrics(rows.map((row) => row.id))
    return new Map(rows.map((row) => [row.ownerUserId!, metrics.get(row.id)!]))
  }

  /** Independent aggregates prevent join fan-out from multiple payments or refunds. */
  async metrics(sourceIds: string[]) {
    const result = new Map(sourceIds.map((id) => [id, emptyPromotionMetrics()]))
    if (!sourceIds.length) {
      return result
    }
    const registrations = await this.source.getRepository(PromotionRegistrationEntity).createQueryBuilder('r').select('r.sourceId', 'sourceId').addSelect('COUNT(*)', 'registrations').where('r.sourceId IN (:...sourceIds)', { sourceIds }).groupBy('r.sourceId').getRawMany<{ sourceId: string, registrations: string }>()
    const payments = await this.source.getRepository(PaymentOrderEntity).createQueryBuilder('o').innerJoin(PromotionRegistrationEntity.options.name, 'r', 'r.userId = o.user_id').select('r.sourceId', 'sourceId').addSelect('SUM(o.amount_cents)', 'amount').addSelect('COUNT(DISTINCT o.user_id)', 'payingUsers').where('r.sourceId IN (:...sourceIds)', { sourceIds }).andWhere('o.status = :paid', { paid: 'paid' }).groupBy('r.sourceId').getRawMany<{ sourceId: string, amount: string, payingUsers: string }>()
    const refunds = await this.source.getRepository(PaymentRefundEntity).createQueryBuilder('f').innerJoin(PaymentOrderEntity.options.name, 'o', 'o.id = f.order_id AND o.status = :paid', { paid: 'paid' }).innerJoin(PromotionRegistrationEntity.options.name, 'r', 'r.userId = o.user_id').select('r.sourceId', 'sourceId').addSelect('SUM(f.amount_cents)', 'amount').where('r.sourceId IN (:...sourceIds)', { sourceIds }).andWhere('f.status = :succeeded', { succeeded: 'succeeded' }).groupBy('r.sourceId').getRawMany<{ sourceId: string, amount: string }>()
    for (const row of registrations) {
      result.get(row.sourceId)!.registrations = Number(row.registrations)
    }
    for (const row of payments) {
      Object.assign(result.get(row.sourceId)!, { paidAmount: currency(BigInt(row.amount)), payingUsers: Number(row.payingUsers) })
    }
    const refundCents = new Map(refunds.map((row) => [row.sourceId, BigInt(row.amount)]))
    const paymentCents = new Map(payments.map((row) => [row.sourceId, BigInt(row.amount)]))
    for (const [id, metrics] of result) {
      metrics.refundedAmount = currency(refundCents.get(id) ?? 0n)
      metrics.netAmount = currency((paymentCents.get(id) ?? 0n) - (refundCents.get(id) ?? 0n))
    }
    return result
  }

  async jsSdk(value: unknown) {
    const input = object(value, ['url'])
    const account = await this.account?.runtime()
    if (!account?.enabled || !account.appSecret) {
      throw ErrorCode.WECHAT_LOGIN_DISABLED()
    }
    return this.sdk.configuration({ ...account, jsapi: true }, input.url)
  }
}
