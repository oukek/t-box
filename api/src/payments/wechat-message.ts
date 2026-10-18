import type { WechatRuntime } from './configuration.js'
import { createDecipheriv, verify } from 'node:crypto'
import { ErrorCode } from '../error-codes.js'

const fail = (message = '微信支付响应校验失败，请稍后核对订单') =>
  ErrorCode.WECHAT_UNAVAILABLE(message)
export function merchantOrder(id: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  ) {
    throw fail()
  }
  return id.replaceAll('-', '')
}
export function localOrder(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/i.test(value)) {
    throw fail()
  }
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`.toLowerCase()
}
export function verifyWechat(
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
  config: WechatRuntime,
  now = Date.now(),
) {
  const timestamp = headers['wechatpay-timestamp']
  const nonce = headers['wechatpay-nonce']
  const signature = headers['wechatpay-signature']
  const serial = headers['wechatpay-serial']
  if (
    typeof timestamp !== 'string' ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    typeof nonce !== 'string' ||
    !/^[\x21-\x7E]{1,128}$/.test(nonce) ||
    typeof signature !== 'string' ||
    !/^[A-Z0-9+/]+={0,2}$/i.test(signature) ||
    signature.length > 2048 ||
    serial !== config.platformSerial
  ) {
    throw fail()
  }
  const payload = Buffer.concat([
    Buffer.from(`${timestamp}\n${nonce}\n`),
    raw,
    Buffer.from('\n'),
  ])
  if (
    !verify(
      'RSA-SHA256',
      payload,
      config.platformPublicKey,
      Buffer.from(signature, 'base64'),
    )
  ) {
    throw fail()
  }
}
export function decryptWechat(
  resource: Record<string, unknown>,
  key: string,
  originalType = 'transaction',
): Record<string, unknown> {
  if (
    resource.algorithm !== 'AEAD_AES_256_GCM' ||
    resource.original_type !== originalType ||
    typeof resource.nonce !== 'string' ||
    Buffer.byteLength(resource.nonce) !== 12 ||
    typeof resource.ciphertext !== 'string' ||
    (resource.associated_data !== undefined &&
      typeof resource.associated_data !== 'string')
  ) {
    throw fail()
  }
  try {
    const bytes = Buffer.from(resource.ciphertext, 'base64')
    if (bytes.length <= 16) {
      throw ErrorCode.INTERNAL_ENCRYPTED_PAYMENT_RESOURCE_HAS_NO_PAYLOAD()
    }
    const cipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(key),
      Buffer.from(resource.nonce),
    )
    cipher.setAuthTag(bytes.subarray(-16))
    cipher.setAAD(
      Buffer.from((resource.associated_data as string | undefined) ?? ''),
    )
    return JSON.parse(
      Buffer.concat([
        cipher.update(bytes.subarray(0, -16)),
        cipher.final(),
      ]).toString('utf8'),
    )
  } catch {
    throw fail()
  }
}
export { fail as wechatFailure }

export async function readWechatBody(response: Response, limit: number) {
  if (
    !response.body ||
    Number(response.headers.get('content-length') || 0) > limit
  ) {
    throw fail('微信支付响应大小无效')
  }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw fail('微信支付响应超过大小限制')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
