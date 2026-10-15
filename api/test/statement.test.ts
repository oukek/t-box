import type { PaymentConfiguration, WechatRuntime } from '../src/payments/configuration.js'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { test } from 'node:test'
import { parseStatementCSV } from '../src/payments/statement.js'
import { readWechatBody } from '../src/payments/wechat-message.js'
import { WechatGateway } from '../src/payments/wechat.js'

const header = '交易时间,商户号,微信订单号,商户订单号,交易状态,货币种类,订单金额,申请退款金额,商户退款单号,微信退款单号,商品名称\r\n'
const paid = '`2026-10-14 12:00:00,`1234567890,`420000000000001,`order123,`SUCCESS,`CNY,`10.00,`0.00,`0,`0,"项目,说明"\r\n'
test('merchant CSV supports quoted cells, backtick IDs, summaries and exact cents without leaking customer columns', () => {
  const rows = parseStatementCSV('\uFEFF' + header + paid + '总交易单数,订单总金额\r\n`1,`10.00\r\n', '1234567890')
  assert.deepEqual(rows, [{ kind: 'payment', orderId: 'order123', transactionId: '420000000000001', amountCents: 1000 }])
  assert.equal(JSON.stringify(rows).includes('说明'), false)
  const refund = paid.replace('`SUCCESS', '`REFUND').replace('`10.00,`0.00,`0,`0', '`0.00,`10.00,`refund123,`500000000000001')
  assert.equal(parseStatementCSV(header + refund, '1234567890')[0]!.amountCents, 1000)
  for (const csv of [header + paid.replace('`CNY', '`USD'), header + paid.replace('`10.00', '`1e3'), header + paid + paid, header + paid.replace('说明"', '说明'), header + paid.replace('`1234567890', '`9876543210')]) {
    assert.throws(() => parseStatementCSV(csv, '1234567890'), { code: 'STATEMENT_INVALID' })
  }
})

test('WeChat body reader rejects oversized responses while streaming', async () => {
  await assert.rejects(readWechatBody(new Response('too large'), 3), { code: 'WECHAT_UNAVAILABLE' })
  assert.equal((await readWechatBody(new Response('ok'), 2)).toString(), 'ok')
})

test('statement download requires signed metadata, a fixed download origin and the exact file hash', async () => {
  const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const platform = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const c = { id: randomUUID(), merchantId: '1234567890', merchantSerial: 'MERCHANT', platformSerial: 'PUB_KEY_ID_fixture', privateKey: merchant.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), platformPublicKey: platform.publicKey.export({ format: 'pem', type: 'spki' }).toString() } as WechatRuntime
  const configuration = { runtime: async () => c, credentials: async () => c } as unknown as PaymentConfiguration
  const bytes = Buffer.from(header + paid)
  let origin = 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=fixture'
  let badSignature = false
  let badFile = false
  let downloads = 0
  const gateway = new WechatGateway(configuration, async (url, options) => {
    assert.equal(options?.redirect, 'error')
    if (String(url).includes('/v3/bill/tradebill?')) {
      const raw = Buffer.from(JSON.stringify({ download_url: origin, hash_type: 'SHA1', hash_value: createHash('sha1').update(bytes).digest('hex') }))
      const timestamp = String(Math.floor(Date.now() / 1000))
      const nonce = 'statement-nonce'
      const signature = sign('RSA-SHA256', Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), raw, Buffer.from('\n')]), platform.privateKey).toString('base64')
      return new Response(raw, { headers: { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-serial': c.platformSerial, 'wechatpay-signature': badSignature ? 'invalid' : signature } })
    }
    downloads++
    assert.equal(new URL(String(url)).origin, 'https://api.mch.weixin.qq.com')
    return new Response(badFile ? Buffer.from('modified') : bytes)
  })
  const result = await gateway.statement('2026-10-14', { configurationId: c.id })
  assert.equal(result.rows.length, 1)
  assert.equal(downloads, 1)
  badSignature = true
  await assert.rejects(gateway.statement('2026-10-14', { configurationId: c.id }))
  assert.equal(downloads, 1)
  badSignature = false
  for (origin of ['https://evil.example/file', 'https://api.mch.weixin.qq.com/other', 'https://api.mch.weixin.qq.com@evil.example/v3/billdownload/file']) {
    await assert.rejects(gateway.statement('2026-10-14', { configurationId: c.id }))
  }
  assert.equal(downloads, 1)
  origin = 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=fixture'
  badFile = true
  await assert.rejects(gateway.statement('2026-10-14', { configurationId: c.id }), { code: 'WECHAT_UNAVAILABLE' })
})
