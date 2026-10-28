import type { PaymentOrder } from '@t-box/shared'
import type { PaymentConfiguration, WechatRuntime } from '../src/payments/configuration.js'
import assert from 'node:assert/strict'
import { createCipheriv, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { test } from 'node:test'
import {
  decryptWechat,
  localOrder,
  merchantOrder,
  verifyWechat,
  WechatGateway,
} from '../src/payments/wechat.js'

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const now = Date.now()
const config = {
  platformSerial: 'PUB_KEY_ID_fixture',
  platformPublicKey: pair.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString(),
} as WechatRuntime

test('payment capability distinguishes a disabled purchase switch from missing channel configuration', async () => {
  let active: WechatRuntime | null = null
  const configuration = { runtime: async () => active } as unknown as PaymentConfiguration
  const gateway = new WechatGateway(configuration)
  assert.match((await gateway.capabilities()).disabledReason!, /尚未保存/)
  active = { ...config, enabled: false, jsapi: true } as WechatRuntime
  assert.equal((await gateway.capabilities()).enabled, false)
  assert.match((await gateway.capabilities()).disabledReason!, /开放新充值订单/)
  active.enabled = true
  const enabled = await gateway.capabilities()
  assert.equal(enabled.enabled, true)
  assert.deepEqual(enabled.modes, ['jsapi'])
  assert.equal(enabled.disabledReason, undefined)
  active.jsapi = false
  assert.match((await gateway.capabilities()).disabledReason!, /尚未启用支付渠道/)
})

test('confirmed checkout links sign JSAPI with the scanning payer OpenID and never fall back to beneficiary OAuth', async () => {
  const c = { ...config, id: randomUUID(), enabled: true, jsapi: true, appId: 'wx_fixture_app', merchantId: '1234567890', merchantSerial: 'A'.repeat(40), privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), apiBaseUrl: 'https://api.tboxos.cn' } as WechatRuntime
  const configuration = { runtime: async () => c, credentials: async () => c } as unknown as PaymentConfiguration
  let requests = 0
  let expectedAmount = 1000
  const gateway = new WechatGateway(configuration, async (_url, init) => {
    requests++
    assert.equal(JSON.parse(String(init?.body)).payer.openid, 'openid_scanning_phone')
    assert.equal(JSON.parse(String(init?.body)).amount.total, expectedAmount)
    const raw = Buffer.from(JSON.stringify({ prepay_id: 'wx_fixture_prepay' }))
    return new Response(raw, { headers: { ...headers(raw), 'Content-Type': 'application/json' } })
  })
  let available = true
  Object.assign(gateway.authorization, { openid: async (userId: string) => {
    assert.equal(userId, 'phone-user')
    return available ? 'openid_scanning_phone' : null
  } })
  const order = { id: randomUUID(), packageName: '资源包', expiresAt: new Date(Date.now() + 600_000).toISOString() } as PaymentOrder
  const intent = await gateway.create(order, 1000, { configurationId: c.id, mode: 'jsapi', userId: 'desktop-recipient', payerUserId: 'phone-user' })
  assert.equal(intent.type, 'jsapi')
  available = false
  await assert.rejects(gateway.create(order, 1000, { configurationId: c.id, mode: 'jsapi', userId: 'desktop-recipient', payerUserId: 'phone-user' }), { code: 'OAUTH_UNAVAILABLE' })
  assert.equal(requests, 1)
  available = true
  expectedAmount = 1
  await gateway.create({ ...order, id: randomUUID() }, 1, { configurationId: c.id, mode: 'jsapi', userId: 'desktop-recipient', payerUserId: 'phone-user' })
  assert.equal(requests, 2, 'A ¥0.01 resource package reaches WeChat as exactly one integer cent')
})
function headers(raw: Buffer, timestamp = Math.floor(now / 1000).toString()) {
  const nonce = 'fixture_nonce'
  return {
    'wechatpay-serial': config.platformSerial,
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    'wechatpay-signature': sign(
      'RSA-SHA256',
      Buffer.concat([
        Buffer.from(`${timestamp}\n${nonce}\n`),
        raw,
        Buffer.from('\n'),
      ]),
      pair.privateKey,
    ).toString('base64'),
  }
}
test('Wechat RSA verification rejects changed bytes, stale timestamp, wrong keys and signature probes', () => {
  const raw = Buffer.from('{\n"fixture":true\n}')
  const valid = headers(raw)
  verifyWechat(raw, valid, config, now)
  assert.throws(() =>
    verifyWechat(Buffer.from('{"fixture":true}'), valid, config, now),
  )
  assert.throws(() =>
    verifyWechat(
      raw,
      headers(raw, Math.floor(now / 1000 - 301).toString()),
      config,
      now,
    ),
  )
  assert.throws(() =>
    verifyWechat(raw, { ...valid, 'wechatpay-serial': 'unknown' }, config, now),
  )
  assert.throws(() =>
    verifyWechat(
      raw,
      { ...valid, 'wechatpay-signature': 'WECHATPAY/SIGNTEST/probe' },
      config,
      now,
    ),
  )
  verifyWechat(Buffer.alloc(0), headers(Buffer.alloc(0)), config, now)
})
test('Wechat AES-GCM rejects tampered resources and maps UUID to legal 32-character merchant order number', () => {
  const key = '0123456789abcdef0123456789abcdef'
  const nonce = 'abcdefghijkl'
  const aad = 'transaction'
  const message = { appid: 'wxfixture', total: 100 }
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(key),
    Buffer.from(nonce),
  )
  cipher.setAAD(Buffer.from(aad))
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(message)),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  const resource = {
    algorithm: 'AEAD_AES_256_GCM',
    original_type: 'transaction',
    nonce,
    associated_data: aad,
    ciphertext: bytes.toString('base64'),
  }
  assert.deepEqual(decryptWechat(resource, key), message)
  assert.throws(() =>
    decryptWechat({ ...resource, associated_data: 'wrong' }, key),
  )
  assert.throws(() => decryptWechat(resource, 'wrong key'))
  const id = '12345678-abcd-4567-89ab-123456789abc'
  assert.equal(merchantOrder(id).length, 32)
  assert.equal(localOrder(merchantOrder(id)), id)
})
