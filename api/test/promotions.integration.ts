import type { PaymentGateway, VerifiedPayment } from '../src/payments/gateway.js'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import jsQR from 'jsqr'
import sharp from 'sharp'
import { In } from 'typeorm'
import { createVault, hashPassword } from '../src/admin/crypto.js'
import { ConfigurationService } from '../src/admin/service.js'
import { AdminStore } from '../src/admin/store.js'
import { createApp } from '../src/app.js'
import { createDataSource } from '../src/db/data-source.js'
import { AdminUserEntity } from '../src/db/entities.js'
import { PlatformConfigurationEntity, PlatformConfigurationHistoryEntity } from '../src/db/records/configuration-entities.js'
import { PaymentOrderEntity, PaymentRefundEntity } from '../src/db/records/payments-entities.js'
import { WechatAccountConfiguration } from '../src/identity/wechat-configuration.js'
import { WechatAccountEntity, WechatFlowEntity } from '../src/identity/wechat-entities.js'
import { WechatLoginService } from '../src/identity/wechat-login.js'
import { PlatformService } from '../src/platform/service.js'
import { PROMOTION_CREATIVE_KEY } from '../src/promotions/creatives.js'
import { PromotionAssetEntity, PromotionRegistrationEntity, PromotionSourceEntity } from '../src/promotions/entities.js'
import { assertDisposableDatabase, cleanupUsers } from './fixtures.js'
import { fixtureOss } from './oss-fixture.js'
import { paymentSelection } from './quota-fixtures.js'

const source = await createDataSource().initialize()
assertDisposableDatabase(source.options.database)
const vault = createVault(randomBytes(32))
const store = new AdminStore(source)
const administration = new ConfigurationService(store, vault)
const account = new WechatAccountConfiguration(source, vault)
const events = new Map<string, VerifiedPayment>()
const gateway: PaymentGateway = {
  channel: 'wechat',
  create: async () => ({ type: 'qr', codeUrl: 'weixin://fixture' }),
  close: async () => {},
  query: async (id) => events.get(id) ?? null,
  verify: async (body) => events.get(body.toString())!,
}
const oss = fixtureOss()
const platform = new PlatformService(source, administration, gateway, undefined, undefined, oss.resources(source), undefined, account)
const transport: typeof fetch = async (input) => {
  const url = new URL(String(input))
  if (url.pathname.endsWith('/access_token')) {
    const code = url.searchParams.get('code')!
    return Response.json({ openid: 'openid_' + code, access_token: code, scope: 'snsapi_userinfo' })
  }
  return Response.json({ openid: url.searchParams.get('openid'), nickname: '推广测试用户', headimgurl: '' })
}
const login = new WechatLoginService(account, platform.identity, transport, platform.promotions)
Object.assign(platform, { wechatLogin: login })
const app = createApp({ platform, administration, bills: {} as never, taskWorker: false, health: async () => ({ mysql: 'up', redis: 'disabled' }) })
const userIds = new Set<string>()
const flowIds: string[] = []
const channelIds: string[] = []
const assetIds: string[] = []
const previousCreative = await source.getRepository(PlatformConfigurationEntity).findOneBy({ config_key: PROMOTION_CREATIVE_KEY })
const marker = randomBytes(6).toString('hex')
const adminName = 'promo_' + marker
const adminPassword = 'fixture-password-' + marker
const adminId = await store.createUser(adminName, await hashPassword(adminPassword))
const previousAccount = await source.getRepository(WechatAccountEntity).findOne({ where: { id: 1 }, select: { id: true, revision: true, enabled: true, appId: true, frontendUrl: true, appSecretCipher: true, updatedBy: true, updatedAt: true } })

async function start(token?: string, kind: 'login' | 'qr' | 'scan' = 'login', parentId?: string) {
  const secret = randomBytes(32).toString('hex')
  const flow = await login.start({ kind, secret, ...(token ? { promotionToken: token } : {}), ...(parentId ? { parentId } : {}) }, randomUUID(), '推广测试设备')
  flowIds.push(flow.id)
  return { ...flow, secret }
}
async function exchange(flow: Awaited<ReturnType<typeof start>>, code: string) {
  const result = await login.exchange({ id: flow.id, secret: flow.secret, state: flow.state, code: marker + '_' + code })
  if (result.user) {
    userIds.add(result.user.id)
  }
  return result
}
async function register(code: string, token?: string) {
  return exchange(await start(token), code)
}
async function paid(userId: string, selection: unknown) {
  const order = await platform.payments.create(userId, selection, randomUUID())
  events.set(order.id, { orderId: order.id, transactionId: 'promo_' + order.id, amountCents: 1000, currency: 'CNY', paidAt: new Date() })
  await platform.payments.notify(Buffer.from(order.id), {})
  await platform.payments.notify(Buffer.from(order.id), {})
  return order
}

try {
  await account.save({ enabled: true, appId: 'wx1234567890abcdef', appSecret: 'fixtureSecret1234567890', frontendUrl: 'https://tboxos.cn', revision: previousAccount?.revision ?? 0 }, adminId)
  const denied = await app.inject({ method: 'POST', url: '/api/v1/admin/promotions/channels', headers: { 'x-admin-request': '1' }, payload: {} })
  assert.equal(denied.statusCode, 401)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/promotions/me' })).statusCode, 401)
  const signed = await app.inject({ method: 'POST', url: '/api/v1/admin/session', headers: { 'x-admin-request': '1' }, payload: { username: adminName, password: adminPassword } })
  assert.equal(signed.statusCode, 200, signed.body)
  const cookie = String(signed.headers['set-cookie']).split(';')[0]!
  const headers = { cookie, 'x-admin-request': '1' }
  const creative = (await app.inject({ url: '/api/v1/admin/promotions/creatives', headers })).json().data
  const uploadHeaders = { ...headers, 'content-type': 'application/octet-stream' }
  const badImage = await app.inject({ method: 'POST', url: '/api/v1/admin/promotions/images/poster', headers: uploadHeaders, payload: Buffer.from('<svg onload="alert(1)"/>') })
  assert.equal(badImage.statusCode, 400)
  const thumbnailBytes = await sharp({ create: { width: 640, height: 320, channels: 3, background: '#ca334b' } }).png().toBuffer()
  const uploadedThumbnail = await app.inject({ method: 'POST', url: '/api/v1/admin/promotions/images/thumbnail', headers: uploadHeaders, payload: thumbnailBytes })
  assert.equal(uploadedThumbnail.statusCode, 200, uploadedThumbnail.body)
  const thumbnail = uploadedThumbnail.json().data
  assetIds.push(thumbnail.id)
  assert.equal(thumbnail.width, 300)
  assert.equal(thumbnail.height, 300)
  const posterBytes = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#f1e9df' } }).png().toBuffer()
  const uploadedPoster = await app.inject({ method: 'POST', url: '/api/v1/admin/promotions/images/poster', headers: uploadHeaders, payload: posterBytes })
  assert.equal(uploadedPoster.statusCode, 200, uploadedPoster.body)
  const poster = uploadedPoster.json().data
  assetIds.push(poster.id)
  const { thumbnail: _thumbnail, poster: _poster, ...currentDraft } = creative
  const updatedDraft = { ...currentDraft, title: '后台自定义分享标题', description: '后台自定义的邀请分享描述。', thumbnailId: thumbnail.id, posterId: poster.id, qr: { x: 64, y: 70, size: 28 } }
  const previewImage = await app.inject({ method: 'POST', url: '/api/v1/admin/promotions/creatives/preview', headers, payload: updatedDraft })
  assert.equal(previewImage.statusCode, 200, previewImage.body.slice(0, 100))
  assert.equal((await platform.promotions.creatives.read()).revision, creative.revision, 'Preview never saves the draft')
  const settingsReply = await app.inject({ method: 'PUT', url: '/api/v1/admin/promotions/creatives', headers, payload: updatedDraft })
  assert.equal(settingsReply.statusCode, 200, settingsReply.body)
  const settings = settingsReply.json().data
  assert.equal(settings.revision, creative.revision + 1)
  assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/admin/promotions/creatives', headers, payload: updatedDraft })).statusCode, 409)
  assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/admin/promotions/creatives', headers, payload: { ...updatedDraft, revision: settings.revision, qr: { x: 64, y: 99, size: 28 } } })).statusCode, 400)
  const actualThumbnail = await app.inject({ url: '/api/v1/promotions/thumbnail.jpg?v=' + settings.revision })
  assert.equal((await sharp(actualThumbnail.rawPayload).metadata()).width, 300)
  const assetReply = await app.inject({ url: '/api/v1' + poster.url })
  assert.equal(assetReply.statusCode, 200)
  assert.equal((await sharp(assetReply.rawPayload).metadata()).height, 1200)
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/promotions/channels', headers, payload: { name: '社群推广', descriptionNote: marker, enabled: true } })
  assert.equal(created.statusCode, 200, created.body)
  const channel = created.json().data
  channelIds.push(channel.id)
  const other = await platform.promotions.saveChannel({ name: '公众号推广', descriptionNote: marker, enabled: true })
  channelIds.push(other.id)
  assert.equal(new URL(channel.shareUrl).searchParams.get('ref'), channel.token)
  assert.equal(channel.registrations, 0)

  const first = await register('first', channel.token)
  assert.ok(first.session)
  assert.equal((await register('first', other.token)).user!.id, first.user!.id)
  await exchange(await start(channel.token), 'first')
  assert.equal((await platform.promotions.metrics([channel.id])).get(channel.id)!.registrations, 1)
  assert.equal((await platform.promotions.metrics([other.id])).get(other.id)!.registrations, 0)

  const organic = await register('organic')
  const personal = await platform.promotions.personal(organic.user!.id)
  assert.equal(personal.title, updatedDraft.title)
  assert.equal(personal.description, updatedDraft.description)
  assert.ok(personal.thumbnailPath.endsWith('v=' + settings.revision))
  assert.equal(personal.shareUrl.includes(organic.user!.id), false)
  const stable = await Promise.all(Array.from({ length: 4 }, () => platform.promotions.personal(organic.user!.id)))
  assert.ok(stable.every((link) => link.token === personal.token))
  const referred = await register('referred', personal.token)
  await register('organic', channel.token)
  assert.equal(await source.getRepository(PromotionRegistrationEntity).existsBy({ userId: organic.user!.id }), false, 'Existing organic users cannot be retroactively attributed')

  const parent = await start(channel.token, 'qr')
  const scanned = await exchange(await start(personal.token, 'scan', parent.id), 'desktop')
  assert.equal((await source.getRepository(PromotionRegistrationEntity).findOneByOrFail({ userId: scanned.user!.id })).sourceId, channel.id, 'Desktop QR source survives scanning and cannot be replaced')
  const noParentSource = await start(undefined, 'qr')
  const organicScan = await exchange(await start(personal.token, 'scan', noParentSource.id), 'desktop_organic')
  assert.equal(await source.getRepository(PromotionRegistrationEntity).existsBy({ userId: organicScan.user!.id }), false)

  const [flowA, flowB] = await Promise.all([start(channel.token), start(other.token)])
  const concurrent = await Promise.all([exchange(flowA, 'concurrent'), exchange(flowB, 'concurrent')])
  assert.equal(concurrent[0].user!.id, concurrent[1].user!.id)
  assert.equal(await source.getRepository(PromotionRegistrationEntity).countBy({ userId: concurrent[0].user!.id }), 1)

  const selection = await paymentSelection(platform.billing)
  const firstOrder = await paid(first.user!.id, selection)
  await paid(first.user!.id, selection)
  await paid(organic.user!.id, selection)
  await paid(referred.user!.id, selection)
  const pending = await platform.payments.create(first.user!.id, selection, randomUUID())
  const closed = await platform.payments.create(first.user!.id, selection, randomUUID())
  await source.getRepository(PaymentOrderEntity).update({ id: closed.id }, { status: 'closed' })
  assert.equal((await platform.payments.get(first.user!.id, pending.id)).status, 'pending')
  for (const [status, cents] of [['succeeded', 100], ['succeeded', 200], ['processing', 500]] as const) {
    await source.getRepository(PaymentRefundEntity).insert({ id: randomUUID(), order_id: firstOrder.id, request_key: randomUUID(), administrator_id: adminId, reason: '推广统计测试', amount_cents: cents, quota_atoms: String(cents * 100), status, submitted: true })
  }
  const metrics = (await platform.promotions.metrics([channel.id])).get(channel.id)!
  assert.equal(metrics.paidAmount, '20.00', 'Multiple refunds and duplicate payment notifications never multiply the sum')
  assert.equal(metrics.refundedAmount, '3.00')
  assert.equal(metrics.netAmount, '17.00')
  assert.equal(metrics.payingUsers, 1)
  const personalMetrics = (await platform.promotions.forUsers([organic.user!.id])).get(organic.user!.id)!
  assert.equal(personalMetrics.registrations, 1)
  assert.equal(personalMetrics.paidAmount, '10.00')

  const list = await app.inject({ url: '/api/v1/admin/promotions/channels', headers })
  assert.equal(list.statusCode, 200, list.body)
  assert.ok(list.json().data.items.some((item: { id: string, paidAmount: string }) => item.id === channel.id && item.paidAmount === '20.00'))
  const users = await app.inject({ url: '/api/v1/admin/billing/users', headers })
  assert.equal(users.statusCode, 200, users.body)
  assert.equal(users.json().data.find((user: { id: string }) => user.id === organic.user!.id).promotion.paidAmount, '10.00')
  const image = await app.inject({ url: '/api/v1' + personal.posterPath + '&download=1' })
  assert.equal(image.statusCode, 200)
  assert.match(String(image.headers['content-disposition']), /attachment/)
  const composed = await sharp(image.rawPayload).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(composed.info.width, 900)
  assert.equal(composed.info.height, 1200)
  const decode = jsQR as unknown as (bytes: Uint8ClampedArray, width: number, height: number) => { data: string } | null
  assert.equal(decode(new Uint8ClampedArray(composed.data), composed.info.width, composed.info.height)?.data, personal.shareUrl)
  const mine = await app.inject({ method: 'POST', url: '/api/v1/promotions/me', headers: { authorization: 'Bearer ' + organic.session!.token } })
  assert.equal(mine.statusCode, 200, mine.body)
  assert.equal(mine.json().data.token, personal.token)
  assert.equal((await app.inject({ url: '/api/v1/promotions/' + 'a'.repeat(32) + '/poster.png' })).statusCode, 404)

  const changed = await platform.promotions.saveChannel({ name: '渠道已改名', descriptionNote: marker, enabled: false, revision: channel.revision }, channel.id)
  assert.equal(changed.token, channel.token)
  assert.equal(changed.paidAmount, '20.00')
  await assert.rejects(platform.promotions.saveChannel({ name: '过期修改', descriptionNote: '', enabled: true, revision: channel.revision }, channel.id), /已更新/)
  const disabled = await register('disabled', channel.token)
  assert.equal(await source.getRepository(PromotionRegistrationEntity).existsBy({ userId: disabled.user!.id }), false)
  await register('invalid', 'f'.repeat(32))
  const resetReply = await app.inject({ method: 'PUT', url: '/api/v1/admin/promotions/creatives', headers, payload: { ...currentDraft, revision: settings.revision, thumbnailId: null, posterId: null } })
  assert.equal(resetReply.statusCode, 200, resetReply.body)
  const resetPersonal = await platform.promotions.personal(organic.user!.id)
  assert.notEqual(resetPersonal.posterPath, personal.posterPath, 'Saved creative revision invalidates stale poster and thumbnail URLs')
  const resetImage = await app.inject({ url: '/api/v1' + resetPersonal.posterPath })
  assert.equal((await sharp(resetImage.rawPayload).metadata()).width, 1080, 'Restoring defaults bypasses cached custom images')
  console.info('Promotion integration passed: first-registration attribution, OAuth/desktop handoff, concurrent registration, channels, personal referrals, payments/refunds and access controls.')
} finally {
  await app.close()
  if (previousCreative) {
    await source.getRepository(PlatformConfigurationEntity).save(previousCreative)
  } else {
    await source.getRepository(PlatformConfigurationEntity).delete({ config_key: PROMOTION_CREATIVE_KEY })
  }
  await source.getRepository(PlatformConfigurationHistoryEntity).delete({ config_key: PROMOTION_CREATIVE_KEY, administrator_id: adminId })
  for (const id of assetIds) {
    const row = await source.getRepository(PromotionAssetEntity).findOneBy({ id })
    if (row) {
      await oss.registry.get(row.backend).remove(row.path)
      await source.getRepository(PromotionAssetEntity).delete({ id })
    }
  }
  if (flowIds.length) {
    await source.getRepository(WechatFlowEntity).delete({ id: In(flowIds) })
  }
  await cleanupUsers(source, [...userIds])
  if (channelIds.length) {
    await source.getRepository(PromotionSourceEntity).delete({ id: In(channelIds) })
  }
  await source.getRepository(AdminUserEntity).delete({ id: adminId })
  if (previousAccount) {
    await source.getRepository(WechatAccountEntity).save(previousAccount)
  } else {
    await source.getRepository(WechatAccountEntity).delete({ id: 1 })
  }
  await source.destroy()
}
