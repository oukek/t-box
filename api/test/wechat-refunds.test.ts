import type { PaymentConfiguration, WechatRuntime } from '../src/payments/configuration.js'
import assert from 'node:assert/strict'
import { createCipheriv, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { test } from 'node:test'
import { parseWechatRefund } from '../src/payments/wechat-refund.js'
import { WechatGateway } from '../src/payments/wechat.js'
import { queryBuilderFixture } from './query-builder-fixture.js'

test('WeChat refund uses the original merchant identity, authenticates signed responses and encrypted callbacks', async () => {
  const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const platform = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const id = randomUUID()
  const orderId = randomUUID()
  const c = { id: randomUUID(), merchantId: '1234567890', merchantSerial: 'MERCHANT', platformSerial: 'PUB_KEY_ID_fixture', apiV3Key: '0'.repeat(32), privateKey: merchant.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), platformPublicKey: platform.publicKey.export({ format: 'pem', type: 'spki' }).toString(), apiBaseUrl: 'https://api.example.test' } as WechatRuntime
  const data: Record<string, unknown> = { out_refund_no: id.replaceAll('-', ''), out_trade_no: orderId.replaceAll('-', ''), transaction_id: '420000000000000000001', refund_id: '500000000000000000001', status: 'PROCESSING', amount: { refund: 100, total: 100, currency: 'CNY' } }
  const configuration = { runtime: async () => c, credentials: async () => c, source: await queryBuilderFixture(async (sql: string) => sql.includes('payment_refunds') ? [{ configuration_id: c.id }] : [{ id: c.id }]) } as unknown as PaymentConfiguration
  const signed = (body: Buffer) => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = 'fixture-nonce'
    return { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-serial': c.platformSerial, 'wechatpay-signature': sign('RSA-SHA256', Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), body, Buffer.from('\n')]), platform.privateKey).toString('base64') }
  }
  const calls: { path: string, body?: string }[] = []
  let corrupt = false
  const gateway = new WechatGateway(configuration, async (url, options) => {
    const path = new URL(String(url)).pathname
    const body = options?.body as string | undefined
    calls.push({ path, body })
    if (body) {
      const payload = JSON.parse(body)
      assert.equal(payload.out_refund_no, id.replaceAll('-', ''))
      assert.equal(payload.transaction_id, data.transaction_id)
      assert.deepEqual(payload.amount, { refund: 100, total: 100, currency: 'CNY' })
      assert.equal(payload.notify_url, 'https://api.example.test/api/v1/payments/webhooks/wechat/refunds')
    }
    const raw = Buffer.from(JSON.stringify(data))
    const headers = signed(raw)
    if (corrupt) {
      headers['wechatpay-signature'] = 'a'.repeat(64)
    }
    return new Response(raw, { headers })
  })
  const receipt = await gateway.refund({ id, orderId, transactionId: String(data.transaction_id), amountCents: 100, reason: 'fixture' }, { configurationId: c.id })
  assert.equal(receipt.status, 'PROCESSING')
  assert.equal((await gateway.queryRefund(id, { configurationId: c.id }))!.id, id)
  assert.equal(calls[1]!.path, '/v3/refund/domestic/refunds/' + id.replaceAll('-', ''))
  corrupt = true
  await assert.rejects(gateway.queryRefund(id, { configurationId: c.id }), { code: 'WECHAT_UNAVAILABLE' })
  const notify = { ...data, mchid: c.merchantId, status: undefined, refund_status: 'SUCCESS', amount: { refund: 100, total: 100 } }
  const nonce = '123456789012'
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(c.apiV3Key), Buffer.from(nonce))
  cipher.setAAD(Buffer.alloc(0))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(notify)), cipher.final(), cipher.getAuthTag()]).toString('base64')
  const raw = Buffer.from(JSON.stringify({ event_type: 'REFUND.SUCCESS', resource_type: 'encrypt-resource', resource: { algorithm: 'AEAD_AES_256_GCM', original_type: 'refund', nonce, ciphertext: encrypted } }))
  const event = await gateway.verifyRefund(raw, signed(raw))
  assert.equal(event.status, 'SUCCESS')
  assert.equal(event.orderId, orderId)
  await assert.rejects(gateway.verifyRefund(Buffer.from('{}'), signed(raw)))
  assert.throws(() => parseWechatRefund({ ...data, amount: { refund: 100, total: 100, currency: 'USD' } }, c))
})
