import type { PaymentConfiguration } from '../src/payments/configuration.js'
import type { PaymentContext, PaymentGateway, VerifiedPayment } from '../src/payments/gateway.js'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { createVault, digest } from '../src/admin/crypto.js'
import { createApp } from '../src/app.js'
import { createDataSource } from '../src/db/data-source.js'
import { WechatAccountConfiguration } from '../src/identity/wechat-configuration.js'
import { WechatAccountEntity, WechatFlowEntity, WechatIdentityEntity } from '../src/identity/wechat-entities.js'
import { WechatLoginService } from '../src/identity/wechat-login.js'
import { CheckoutLinkEntity } from '../src/payments/checkout-link-entity.js'
import { PlatformService } from '../src/platform/service.js'
import { assertDisposableDatabase, cleanupUsers } from './fixtures.js'
import { paymentSelection } from './quota-fixtures.js'

const source = await createDataSource().initialize()
assertDisposableDatabase(source.options.database)
const users: string[] = []
const submissions: PaymentContext[] = []
let verified: VerifiedPayment | null = null
let expectedCents = 1000
const gateway: PaymentGateway = {
  channel: 'wechat',
  async create(_order, cents, context) {
    assert.equal(cents, expectedCents)
    submissions.push(context!)
    return { type: 'jsapi', parameters: { appId: 'wx_fixture', timeStamp: '123', nonceStr: 'nonce', package: 'prepay_id=fixture', signType: 'RSA', paySign: 'signature' } }
  },
  async jsapiConfiguration() {
    return { appId: 'wx_fixture', timestamp: 123, nonceStr: 'nonce', signature: 'fixture' }
  },
  async close() {},
  async query(id) {
    return verified?.orderId === id ? verified : null
  },
  async verify() {
    assert.ok(verified)
    return verified
  },
}
const config = { runtime: async () => ({ jsapi: true, frontendUrl: 'https://tboxos.cn' }) } as unknown as PaymentConfiguration
const platform = new PlatformService(source, undefined, gateway, config)
const vault = createVault(randomBytes(32))
const account = new WechatAccountConfiguration(source, vault)
const appId = 'wx1234567890abcdef'
const login = new WechatLoginService(account, platform.identity, async (input) => {
  const url = new URL(String(input))
  return Response.json(url.pathname.endsWith('access_token')
    ? { openid: `openid_${url.searchParams.get('code')}_123456789`, access_token: 'fixture', scope: 'snsapi_userinfo' }
    : { openid: url.searchParams.get('openid'), nickname: '微信资料', headimgurl: '' })
})
async function authorize(checkoutTicket: string, code: string, started?: () => Promise<void>) {
  const secret = randomBytes(32).toString('hex')
  const flow = await login.start({ kind: 'login', secret, checkoutTicket }, randomUUID(), '手机微信')
  await started?.()
  const result = await login.exchange({ id: flow.id, secret, state: flow.state, code })
  return result.session!.token
}
Object.assign(platform, { wechatLogin: login })
const app = createApp({ platform, corsOrigins: ['https://tboxos.cn'], bills: {} as any, taskWorker: false, health: async () => ({ mysql: 'up', redis: 'disabled' }) })
const sockets: Awaited<ReturnType<typeof app.injectWS>>[] = []
async function until(check: () => boolean) {
  const end = Date.now() + 2500
  while (!check()) {
    assert.ok(Date.now() < end, 'Expected state was not pushed over Socket')
    await pause(10)
  }
}
async function observe(subscription: Record<string, unknown>) {
  await app.ready()
  const socket = await app.injectWS('/api/v1/qr/ws', { headers: { origin: 'https://tboxos.cn' } })
  sockets.push(socket)
  const events: { type: string, code?: string, data?: { stage: string } }[] = []
  socket.on('message', (data) => events.push(JSON.parse(data.toString())))
  socket.send(JSON.stringify(subscription))
  await until(() => events.length > 0)
  return events
}
async function call(path: string, token: string, body: unknown = {}, status = 200) {
  const reply = await app.inject({ method: 'POST', url: `/api/v1/payments/${path}`, headers: { authorization: `Bearer ${token}` }, payload: body as any })
  assert.equal(reply.statusCode, status, `${path}: ${reply.body}`)
  return reply.json().data
}
const ticket = (url: string) => new URLSearchParams(new URL(url).hash.split('?')[1]).get('ticket')!
async function publishDraft(id: string, draft: unknown) {
  const current = (await platform.billing.catalog.list()).find((row) => row.id === id)!
  await platform.billing.catalog.save(draft, id, current.revision)
  const updated = (await platform.billing.catalog.list()).find((row) => row.id === id)!
  await platform.billing.catalog.publish(id, updated.revision)
}
try {
  const a = await platform.identity.register({ username: `buyer_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '下单用户' }, 'fixture')
  const b = await platform.identity.register({ username: `payer_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '扫码用户' }, 'fixture')
  users.push(a.user.id, b.user.id)
  await account.save({ enabled: true, appId, appSecret: 'A'.repeat(32), frontendUrl: 'https://tboxos.cn', revision: 0 }, randomUUID())
  for (const [code, userId] of [['a', a.user.id], ['b', b.user.id]]) {
    const openid = `openid_${code}_123456789`
    await source.getRepository(WechatIdentityEntity).insert({ appId, userId, openidHash: digest(openid), openidCipher: vault.encrypt(openid), avatarUrl: '', updatedAt: new Date() })
  }
  const selection = await paymentSelection(platform.billing)
  const own = await platform.payments.create(a.user.id, selection, randomUUID())
  await call(`orders/${own.id}/handoff`, b.token, {}, 404)
  const ownLink = await call(`orders/${own.id}/handoff`, a.token)
  assert.equal(new URL(ownLink.url).origin, 'https://tboxos.cn')
  assert.equal(ownLink.url.includes(a.token), false)
  const ownTicket = ticket(ownLink.url)
  assert.match(ownTicket, /^[a-f0-9]{64}$/)
  await call('handoff/preview', a.token, { ticket: ownTicket }, 409)
  await call('handoff/intent', a.token, { ticket: ownTicket }, 409)
  assert.equal(submissions.length, 0, 'A cached Tbox login cannot replace a fresh WeChat identity check')
  const ownEvents = await observe({ type: 'payment', token: a.token, orderId: own.id })
  assert.equal(ownEvents[0]!.data?.stage, 'waiting')
  const stolenEvents = await observe({ type: 'payment', token: b.token, orderId: own.id })
  assert.equal(stolenEvents[0]!.type, 'error')
  const ownToken = await authorize(ownTicket, 'a', async () => {
    await until(() => ownEvents.some((event) => event.data?.stage === 'scanned'))
    const attempts = await Promise.allSettled([authorize(ownTicket, 'a'), authorize(ownTicket, 'b')])
    assert.ok(attempts.every((result) => result.status === 'rejected'), 'Even another phone using the same WeChat account cannot take over the scanned QR')
    await call(`orders/${own.id}/handoff`, a.token, {}, 409)
    await call(`orders/${own.id}/intent`, a.token, { mode: 'jsapi' }, 409)
  })
  await until(() => ownEvents.some((event) => event.data?.stage === 'confirming'))
  const ownPreview = await call('handoff/preview', ownToken, { ticket: ownTicket })
  assert.equal(ownPreview.sameAccount, true)
  assert.equal(submissions.length, 0, 'Preview never creates a WeChat payment')
  await call('handoff/intent', ownToken, { ticket: ownTicket })
  assert.equal(submissions[0]!.payerUserId, a.user.id)
  await until(() => ownEvents.some((event) => event.data?.stage === 'paying'))
  const reconnected = await observe({ type: 'payment', token: a.token, orderId: own.id })
  assert.equal(reconnected[0]!.data?.stage, 'paying', 'A reconnected desktop receives the current scan/payment snapshot')

  const other = await platform.payments.create(a.user.id, selection, randomUUID())
  const otherLink = await call(`orders/${other.id}/handoff`, a.token)
  const otherTicket = ticket(otherLink.url)
  await call('handoff/preview', ownToken, { ticket: otherTicket }, 409)
  const otherEvents = await observe({ type: 'payment', token: a.token, orderId: other.id })
  const payerToken = await authorize(otherTicket, 'b')
  await call('handoff/preview', b.token, { ticket: otherTicket }, 409)
  const mismatch = await call('handoff/preview', payerToken, { ticket: otherTicket })
  assert.equal(mismatch.sameAccount, false)
  assert.equal(mismatch.recipient.nickname, '下单用户')
  const before = submissions.length
  await call('handoff/intent', payerToken, { ticket: otherTicket }, 409)
  await call('handoff/intent', payerToken, { ticket: otherTicket, confirmedRecipientId: b.user.id }, 409)
  await call('handoff/intent', payerToken, { ticket: otherTicket, payerUserId: a.user.id, confirmedRecipientId: a.user.id }, 400)
  await call('handoff/js-sdk', payerToken, { ticket: otherTicket, url: 'https://tboxos.cn/' }, 409)
  assert.equal(submissions.length, before, 'An unconfirmed account mismatch never reaches the payment gateway')
  await call('handoff/intent', payerToken, { ticket: otherTicket, confirmedRecipientId: a.user.id })
  const submitted = submissions.at(-1)!
  assert.equal(submitted.userId, a.user.id, 'The beneficiary remains the authenticated desktop order owner')
  assert.equal(submitted.payerUserId, b.user.id, 'The payer comes from the scanning phone login, never link parameters')
  assert.equal((await call('handoff/js-sdk', payerToken, { ticket: otherTicket, url: 'https://tboxos.cn/' })).appId, 'wx_fixture')
  await assert.rejects(authorize(otherTicket, 'a'), /另一台手机/)
  await source.getRepository(WechatFlowEntity).update({ sessionHash: digest(payerToken) }, { expiresAt: new Date(Date.now() - 1000) })
  await call('handoff/intent', payerToken, { ticket: otherTicket, confirmedRecipientId: a.user.id }, 409)
  const phoneEvents = await observe({ type: 'handoff', token: payerToken, ticket: otherTicket })
  verified = { orderId: other.id, transactionId: '4200000000000000042', amountCents: 1000, currency: 'CNY', paidAt: new Date() }
  await platform.payments.notify(Buffer.from('{}'), {})
  await until(() => otherEvents.some((event) => event.data?.stage === 'paid') && phoneEvents.some((event) => event.data?.stage === 'paid'))
  await call('handoff/refresh', payerToken, { ticket: otherTicket })
  await call('handoff/refresh', payerToken, { ticket: otherTicket })
  assert.equal((await platform.billing.wallet(a.user.id)).balance, '10.0000')
  assert.equal((await platform.billing.wallet(b.user.id)).balance, '0.0000', 'Paying for another account never credits the payer')
  assert.equal((await platform.payments.get(a.user.id, other.id)).status, 'paid')

  verified = null
  const fresh = await platform.payments.create(a.user.id, selection, randomUUID())
  const firstLink = await call(`orders/${fresh.id}/handoff`, a.token)
  const results = await Promise.allSettled([authorize(ticket(firstLink.url), 'a'), authorize(ticket(firstLink.url), 'b')])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, 'Atomic first-scan claim permits one phone only')
  const winner = results.find((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')!.value
  await call('handoff/cancel', winner, { ticket: ticket(firstLink.url) })
  const secondLink = await call(`orders/${fresh.id}/handoff`, a.token)
  await call('handoff/preview', a.token, { ticket: ticket(firstLink.url) }, 410)
  const [stored] = await source.query('SELECT token_hash FROM wechat_checkout_links WHERE order_id=?', [fresh.id])
  assert.notEqual(stored.token_hash, ticket(secondLink.url))
  await source.getRepository(CheckoutLinkEntity).update({ orderId: fresh.id }, { expiresAt: new Date(Date.now() - 1000) })
  await call('handoff/preview', a.token, { ticket: ticket(secondLink.url) }, 410)
  const productsBefore = await platform.billing.catalog.list()
  const product = productsBefore.find((row) => row.id === selection.packageId)!
  const otherSelling = productsBefore.filter((row) => row.id !== product.id && row.published?.enabled)
  // Isolate the one-cent fixture from the independent selling-price ladder.
  // This suite is guarded to use a disposable database only.
  for (const row of otherSelling) {
    await publishDraft(row.id, { ...row.draft, enabled: false })
  }
  await platform.billing.catalog.save({ ...product.draft, price: '0.01' }, product.id, product.revision)
  const changed = (await platform.billing.catalog.list()).find((row) => row.id === product.id)!
  await platform.billing.catalog.publish(changed.id, changed.revision)
  const oneCent = await platform.payments.create(a.user.id, { packageId: product.id, version: (product.published?.version ?? 0) + 1 }, randomUUID())
  assert.equal(oneCent.amount, '0.010000')
  assert.equal((await platform.payments.get(a.user.id, own.id)).amount, '10.000000', 'Publishing a cheaper version never changes the frozen price of an existing order')
  const centLink = await call(`orders/${oneCent.id}/handoff`, a.token)
  const centTicket = ticket(centLink.url)
  const centPayer = await authorize(centTicket, 'a')
  expectedCents = 1
  await call('handoff/intent', centPayer, { ticket: centTicket })
  verified = { orderId: oneCent.id, transactionId: '4200000000000000043', amountCents: 1, currency: 'CNY', paidAt: new Date() }
  await platform.payments.notify(Buffer.from('{}'), {})
  await platform.payments.notify(Buffer.from('{}'), {})
  assert.equal((await platform.billing.wallet(a.user.id)).balance, '20.0000', 'A one-cent order grants its frozen quota once, independently of the CNY price')
  await publishDraft(product.id, product.draft)
  for (const row of otherSelling) {
    await publishDraft(row.id, row.draft)
  }
  console.log('Checkout links integration passed: Socket scan/confirmation/payment/settlement states, reconnect snapshots, unauthorized subscriptions rejected, atomic same/different-account phone claims, safe cancellation,  owned order, opaque expiring links, same-account payment, mandatory explicit cross-account consent, fixed payer and beneficiary, duplicate settlement and link rotation.')
} finally {
  sockets.forEach((socket) => socket.terminate())
  await app.close()
  await source.query(`DELETE FROM payment_orders WHERE user_id IN (${users.map(() => '?').join(',') || 'NULL'})`, users)
  await cleanupUsers(source, users)
  await source.getRepository(WechatAccountEntity).clear()
  await source.destroy()
}
