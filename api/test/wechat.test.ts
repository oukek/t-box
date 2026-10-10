import type { WechatRuntime } from '../src/payments/configuration.js'
import assert from 'node:assert/strict'
import { createCipheriv, generateKeyPairSync, sign } from 'node:crypto'
import { test } from 'node:test'
import {
  decryptWechat,
  localOrder,
  merchantOrder,
  verifyWechat,
} from '../src/payments/wechat.js'

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const now = Date.now()
const config = {
  platformSerial: 'PUB_KEY_ID_fixture',
  platformPublicKey: pair.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString(),
} as WechatRuntime
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
