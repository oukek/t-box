import type { DataSource, EntityManager } from 'typeorm'
/** Disposable identities, isolated settings pointer, locally signed channel fixtures. No external payment calls. */
import assert from 'node:assert/strict'
import {
  createCipheriv,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from 'node:crypto'
import { createVault, hashPassword } from '../src/admin/crypto.js'
import { createDataSource } from '../src/db/data-source.js'
import { PaymentConfiguration } from '../src/payments/configuration.js'
import { PaymentService } from '../src/payments/service.js'
import { merchantOrder, WechatGateway } from '../src/payments/wechat.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const users: string[] = []
const adminId = randomUUID()
const settingsId = 1_900_000_000 + Math.floor(Math.random() * 100_000)
const rewrite = (sql: string) =>
  sql.includes('payment_settings')
    ? sql.replaceAll('id=1', `id=${settingsId}`)
    : sql
const isolated = new Proxy(source, {
  get(target, key) {
    if (key === 'query') {
      return (sql: string, args?: unknown[]) =>
        target.query(rewrite(sql), args)
    }
    if (key === 'transaction') {
      return (work: (db: EntityManager) => Promise<unknown>) =>
        target.transaction((db) =>
          work(
            new Proxy(db, {
              get(manager, k) {
                if (k === 'query') {
                  return (sql: string, args?: unknown[]) =>
                    manager.query(rewrite(sql), args)
                }
                return Reflect.get(manager, k, manager)
              },
            }),
          ),
        )
    }
    return Reflect.get(target, key, target)
  },
}) as DataSource
const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 })
const platform = generateKeyPairSync('rsa', { modulusLength: 2048 })
const config = new PaymentConfiguration(isolated, createVault(randomBytes(32)))
const settings = {
  enabled: true,
  appId: 'wx1234567890123456',
  mobileAppId: 'wx9876543210123456',
  app: true,
  merchantId: '1234567890',
  merchantSerial: 'A'.repeat(40),
  platformSerial: 'PUB_KEY_ID_fixture',
  platformPublicKey: platform.publicKey
    .export({ format: 'pem', type: 'spki' })
    .toString(),
  privateKey: merchant.privateKey
    .export({ format: 'pem', type: 'pkcs8' })
    .toString(),
  apiV3Key: '0123456789abcdef0123456789abcdef',
  appSecret: 'A'.repeat(32),
  apiBaseUrl: 'https://api.fixture.example',
  frontendUrl: 'https://app.fixture.example',
  description: 'Fixture 服务余额',
  native: true,
  h5: true,
  jsapi: true,
}
function signed(
  raw: Buffer,
  key = platform.privateKey,
  serial = settings.platformSerial,
) {
  const timeStamp = Math.floor(Date.now() / 1000).toString()
  const nonce = 'fixture_nonce'
  return {
    'wechatpay-timestamp': timeStamp,
    'wechatpay-nonce': nonce,
    'wechatpay-serial': serial,
    'wechatpay-signature': sign(
      'RSA-SHA256',
      Buffer.concat([
        Buffer.from(`${timeStamp}\n${nonce}\n`),
        raw,
        Buffer.from('\n'),
      ]),
      key,
    ).toString('base64'),
  }
}
let transaction: Record<string, unknown> | null = null
let remoteCalls = 0
let expectedMerchantKey = merchant.publicKey
let expectedMerchantSerial = settings.merchantSerial
let responseKey = platform.privateKey
let responseSerial = settings.platformSerial
const fetchFixture: typeof fetch = async (url, init) => {
  const u = new URL(String(url))
  if (u.hostname === 'api.weixin.qq.com') {
    return new Response(JSON.stringify({ openid: 'openid_fixture_user' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  assert.equal(u.hostname, 'api.mch.weixin.qq.com')
  remoteCalls++
  const header = new Headers(init?.headers).get('Authorization')!
  const parts = Object.fromEntries(
    [...header.matchAll(/([a-z_]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]),
  )
  assert.equal(parts.mchid, settings.merchantId)
  assert.equal(parts.serial_no, expectedMerchantSerial)
  const body = String(init?.body ?? '')
  assert(
    verify(
      'RSA-SHA256',
      Buffer.from(
        `${init?.method}\n${u.pathname}${u.search}\n${parts.timestamp}\n${parts.nonce_str}\n${body}\n`,
      ),
      expectedMerchantKey,
      Buffer.from(parts.signature!, 'base64'),
    ),
  )
  let response: Record<string, unknown> = {}
  let status = 200
  if (u.pathname.endsWith('/native')) {
    const data = JSON.parse(body)
    assert.equal(data.out_trade_no.length, 32)
    assert.equal(data.amount.total, 1000)
    assert.equal(
      data.notify_url,
      'https://api.fixture.example/api/v1/payments/webhooks/wechat',
    )
    response = { code_url: 'weixin://wxpay/bizpayurl?pr=fixture' }
  } else if (u.pathname.endsWith('/h5')) {
    assert.equal(JSON.parse(body).scene_info.payer_client_ip, '203.0.113.10')
    response = {
      h5_url:
        'https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=fixture',
    }
  } else if (u.pathname.endsWith('/app')) {
    const data = JSON.parse(body)
    assert.equal(data.appid, settings.mobileAppId)
    assert.equal(data.mchid, settings.merchantId)
    assert.equal(data.amount.total, 1000)
    assert(!('payer' in data))
    response = { prepay_id: 'prepay_app_fixture' }
  } else if (u.pathname.endsWith('/jsapi')) {
    assert.equal(JSON.parse(body).payer.openid, 'openid_fixture_user')
    response = { prepay_id: 'prepay_fixture' }
  } else if (u.pathname.endsWith('/close')) {
    status = 204
  } else {
    if (!transaction) {
      throw new Error('missing transaction')
    }
    response = transaction
  }
  const raw =
    status === 204 ? Buffer.alloc(0) : Buffer.from(JSON.stringify(response))
  return new Response(status === 204 ? null : raw, {
    status,
    headers: {
      ...signed(raw, responseKey, responseSerial),
      'Content-Type': 'application/json',
    },
  })
}
const gateway = new WechatGateway(config, fetchFixture)
const p = new PlatformService(
  source,
  undefined,
  gateway,
  config,
  gateway.authorization,
)
const fixturePayments = new PaymentService(source, p.billing, gateway, {
  async bonusCents() {
    return 0
  },
})
function notify(
  id: string,
  total = 1000,
  key = platform.privateKey,
  serial = settings.platformSerial,
  apiKey = settings.apiV3Key,
  appId = settings.appId,
  transactionId = '4200000000000000001',
) {
  const message = {
    appid: appId,
    trade_type: appId === settings.mobileAppId ? 'APP' : 'NATIVE',
    mchid: settings.merchantId,
    out_trade_no: merchantOrder(id),
    transaction_id: transactionId,
    trade_state: 'SUCCESS',
    success_time: new Date().toISOString(),
    amount: { total, currency: 'CNY' },
  }
  const nonce = 'abcdefghijkl'
  const associated_data = 'transaction'
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(apiKey),
    Buffer.from(nonce),
  )
  cipher.setAAD(Buffer.from(associated_data))
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(message)),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  const raw = Buffer.from(
    JSON.stringify({
      event_type: 'TRANSACTION.SUCCESS',
      resource_type: 'encrypt-resource',
      resource: {
        original_type: 'transaction',
        algorithm: 'AEAD_AES_256_GCM',
        nonce,
        associated_data,
        ciphertext: bytes.toString('base64'),
      },
    }),
  )
  return { raw, headers: signed(raw, key, serial) }
}
try {
  await source.query('INSERT INTO payment_settings(id) VALUES(?)', [
    settingsId,
  ])
  await source.query(
    'INSERT INTO admin_users(id,username,password_hash) VALUES(?,?,?)',
    [adminId, `wx_${adminId.slice(0, 8)}`, await hashPassword('fixture123')],
  )
  await assert.rejects(
    config.save({ ...settings, apiV3Key: 'short' }, adminId),
    { code: 'INVALID_PAYMENT_CONFIG' },
  )
  await config.save(settings, adminId)
  const view = await config.view()
  assert.equal(view.hasPrivateKey, true)
  assert(!('privateKey' in view))
  assert(!('appSecret' in view))
  const a = await p.identity.register(
    {
      username: `wx_${randomUUID().replaceAll('-', '')}`,
      password: 'fixture123',
    },
    'wechat-fixture',
  )
  users.push(a.user.id)
  const native = await fixturePayments.create(a.user.id, '10', randomUUID())
  const qr = await p.payments.intent(a.user.id, native.id, 'native')
  assert.equal(qr.type, 'qr')
  await assert.rejects(
    p.payments.intent(a.user.id, native.id, 'h5', '203.0.113.10'),
    { code: 'PAYMENT_MODE_LOCKED' },
  )
  const wrong = notify(native.id, 900)
  await assert.rejects(p.payments.notify(wrong.raw, wrong.headers), {
    code: 'PAYMENT_MISMATCH',
  })
  assert.equal((await p.billing.wallet(a.user.id)).balance, '0.000000')
  const valid = notify(native.id)
  await Promise.all([
    p.payments.notify(valid.raw, valid.headers),
    p.payments.notify(valid.raw, valid.headers),
  ])
  assert.equal((await p.billing.wallet(a.user.id)).balance, '10.000000')
  await assert.rejects(
    p.payments.notify(Buffer.from(valid.raw.toString() + ' '), valid.headers),
  )
  console.info(
    '✓ Native request/response signatures, exact merchant order number, forged callbacks and concurrent duplicate credit',
  )
  const h5 = await fixturePayments.create(a.user.id, '10', randomUUID())
  const link = await p.payments.intent(a.user.id, h5.id, 'h5', '203.0.113.10')
  assert.equal(link.type, 'redirect')
  if (link.type === 'redirect') {
    assert.equal(
      new URL(link.url).searchParams.get('redirect_url'),
      `https://app.fixture.example/#/ai/recharge?paymentOrder=${h5.id}`,
    )
  }
  const js = await fixturePayments.create(a.user.id, '10', randomUUID())
  const auth = await p.payments.intent(a.user.id, js.id, 'jsapi')
  assert.equal(auth.type, 'redirect')
  if (auth.type !== 'redirect') {
    throw new Error('missing oauth')
  }
  const authUrl = new URL(auth.url)
  assert.equal(authUrl.hostname, 'open.weixin.qq.com')
  assert.equal(authUrl.searchParams.get('scope'), 'snsapi_base')
  const state = authUrl.searchParams.get('state')
  const returnUrl = await gateway.authorization.callback(state, 'fixture_code')
  assert(returnUrl.endsWith('&wechatAuthorized=1'))
  await assert.rejects(gateway.authorization.callback(state, 'fixture_code'), {
    code: 'OAUTH_EXPIRED',
  })
  const intent = await p.payments.intent(a.user.id, js.id, 'jsapi')
  assert.equal(intent.type, 'jsapi')
  if (intent.type === 'jsapi') {
    const x = intent.parameters
    assert(
      verify(
        'RSA-SHA256',
        Buffer.from(
          `${x.appId}\n${x.timeStamp}\n${x.nonceStr}\n${x.package}\n`,
        ),
        merchant.publicKey,
        Buffer.from(x.paySign, 'base64'),
      ),
    )
  }
  console.info(
    '✓ H5 IP/return URL, service-account OAuth single-use state and JSAPI RSA browser parameters',
  )
  transaction = {
    appid: settings.appId,
    trade_type: 'H5',
    mchid: settings.merchantId,
    out_trade_no: merchantOrder(h5.id),
    transaction_id: '4200000000000000002',
    trade_state: 'SUCCESS',
    success_time: new Date().toISOString(),
    amount: { total: 1000, currency: 'CNY' },
  }
  await p.payments.refresh(a.user.id, h5.id)
  assert.equal((await p.billing.wallet(a.user.id)).balance, '20.000000')
  const appOrder = await fixturePayments.create(a.user.id, '10', randomUUID())
  const appIntent = await p.payments.intent(a.user.id, appOrder.id, 'app')
  assert.equal(appIntent.type, 'app')
  if (appIntent.type !== 'app') {
    throw new Error('missing APP payment')
  }
  const x = appIntent.parameters
  assert.equal(x.appId, settings.mobileAppId)
  assert.equal(x.partnerId, settings.merchantId)
  assert.equal(x.packageValue, 'Sign=WXPay')
  assert(
    verify(
      'RSA-SHA256',
      Buffer.from(`${x.appId}\n${x.timeStamp}\n${x.nonceStr}\n${x.prepayId}\n`),
      merchant.publicKey,
      Buffer.from(x.sign, 'base64'),
    ),
  )
  assert(
    !verify(
      'RSA-SHA256',
      Buffer.from(
        `${x.appId}\n${x.timeStamp}\n${x.nonceStr}\nprepay_id=${x.prepayId}\n`,
      ),
      merchant.publicKey,
      Buffer.from(x.sign, 'base64'),
    ),
  )
  await assert.rejects(p.payments.intent(a.user.id, appOrder.id, 'native'), {
    code: 'PAYMENT_MODE_LOCKED',
  })
  const foreignAccount = notify(
    appOrder.id,
    1000,
    platform.privateKey,
    settings.platformSerial,
    settings.apiV3Key,
    settings.appId,
    '4200000000000000004',
  )
  await assert.rejects(
    p.payments.notify(foreignAccount.raw, foreignAccount.headers),
  )
  assert.equal((await p.billing.wallet(a.user.id)).balance, '20.000000')
  // Query uses the mode stored on the order, not an AppID supplied by the client.
  transaction = {
    ...transaction,
    out_trade_no: merchantOrder(appOrder.id),
    transaction_id: '4200000000000000004',
  }
  await assert.rejects(p.payments.reconcile(appOrder.id))
  transaction.appid = settings.mobileAppId
  await assert.rejects(p.payments.reconcile(appOrder.id)) // Correct AppID alone does not authorize another trade type.
  transaction.trade_type = 'APP'
  await p.payments.reconcile(appOrder.id)
  const appSuccess = notify(
    appOrder.id,
    1000,
    platform.privateKey,
    settings.platformSerial,
    settings.apiV3Key,
    settings.mobileAppId,
    '4200000000000000004',
  )
  await Promise.all([
    p.payments.notify(appSuccess.raw, appSuccess.headers),
    p.payments.notify(appSuccess.raw, appSuccess.headers),
  ])
  assert.equal((await p.billing.wallet(a.user.id)).balance, '30.000000')
  const caps = await p.payments.capabilities()
  assert(caps.modes?.includes('app'))
  assert.equal(caps.mobileAppId, settings.mobileAppId)
  console.info(
    '✓ APP mobile AppID, raw prepay_id RSA signature, immutable channel, cross-account query/notification rejection and idempotent settlement',
  )
  const oldId = (await config.view()).id
  const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const rotatedMerchant = generateKeyPairSync('rsa', { modulusLength: 2048 })
  await config.save(
    {
      ...settings,
      id: oldId,
      enabled: false,
      platformSerial: 'PUB_KEY_ID_rotated',
      platformPublicKey: rotated.publicKey
        .export({ format: 'pem', type: 'spki' })
        .toString(),
      merchantSerial: 'B'.repeat(40),
      privateKey: rotatedMerchant.privateKey
        .export({ format: 'pem', type: 'pkcs8' })
        .toString(),
      apiV3Key: 'abcdef0123456789abcdef0123456789',
      appSecret: '',
    },
    adminId,
  )
  expectedMerchantKey = rotatedMerchant.publicKey
  expectedMerchantSerial = 'B'.repeat(40)
  responseKey = rotated.privateKey
  responseSerial = 'PUB_KEY_ID_rotated'
  const currentCredentials = await config.credentials(
    (await config.runtime(oldId))!,
  )
  assert.equal(currentCredentials.id, oldId)
  assert.equal(currentCredentials.merchantSerial, expectedMerchantSerial)
  transaction = {
    ...transaction,
    appid: settings.appId,
    trade_type: 'NATIVE',
    out_trade_no: merchantOrder(native.id),
    transaction_id: '4200000000000000001',
  }
  const oldPayment = await gateway.query(native.id, { configurationId: oldId })
  assert.equal(oldPayment!.configurationId, oldId)
  assert.equal((await p.payments.capabilities()).enabled, false)
  await assert.rejects(fixturePayments.create(a.user.id, '1', randomUUID()), {
    code: 'PAYMENT_NOT_CONFIGURED',
  })
  const late = notify(js.id, 1000, rotated.privateKey, 'PUB_KEY_ID_rotated')
  // Different order needs a different channel transaction id.
  const payload = JSON.parse(late.raw.toString())
  const decoded = {
    ...transaction,
    out_trade_no: merchantOrder(js.id),
    trade_type: 'JSAPI',
    transaction_id: '4200000000000000003',
  }
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from('abcdef0123456789abcdef0123456789'),
    Buffer.from('abcdefghijkl'),
  )
  cipher.setAAD(Buffer.from('transaction'))
  payload.resource.ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(decoded)),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64')
  const lateRaw = Buffer.from(JSON.stringify(payload))
  await p.payments.notify(
    lateRaw,
    signed(lateRaw, rotated.privateKey, 'PUB_KEY_ID_rotated'),
  )
  assert.equal((await p.billing.wallet(a.user.id)).balance, '40.000000')
  await assert.rejects(config.save({ ...settings, id: oldId }, adminId), {
    code: 'PAYMENT_CONFIG_STALE',
  })
  const latest = await config.view()
  await config.save(
    {
      ...settings,
      id: latest.id,
      appId: '',
      frontendUrl: '',
      appSecret: '',
      native: false,
      h5: false,
      jsapi: false,
      app: true,
    },
    adminId,
  )
  assert.deepEqual((await gateway.capabilities()).modes, ['app'])
  await assert.rejects(
    config.save({ ...(await config.view()), mobileAppId: '' }, adminId),
    { code: 'INVALID_PAYMENT_CONFIG' },
  )
  console.info(
    '✓ APP-only merchant configuration does not require service-account AppID/AppSecret or website URL',
  )
  assert(remoteCalls >= 4)
  console.info(
    '✓ Trusted query settles owned orders; disabled new orders and rotated verification keys preserve old-order merchant identity',
  )
} finally {
  await cleanupUsers(source, users)
  await source.query('DELETE FROM payment_settings WHERE id=?', [settingsId])
  await source.query(
    'DELETE FROM payment_configurations WHERE administrator_id=?',
    [adminId],
  )
  await source.query('DELETE FROM admin_users WHERE id=?', [adminId])
  await source.destroy()
}
