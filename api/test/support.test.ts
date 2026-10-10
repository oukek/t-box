import type { DataSource } from 'typeorm'
import type { PlatformService } from '../src/platform/service.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '@t-box/server-foundation/errors'
import Fastify from 'fastify'
import { registerCustomerSupport } from '../src/support/routes.js'
import { CustomerSupportService } from '../src/support/service.js'
import { parseSupportConfiguration } from '../src/support/validation.js'

test('support config requires HTTPS image URLs and rejects unsupported purchase fields', () => {
  assert.deepEqual(
    parseSupportConfiguration({ enabled: false, qrCodeUrl: '' }),
    { enabled: false, qrCodeUrl: '' },
  )
  assert.deepEqual(
    parseSupportConfiguration({
      enabled: true,
      qrCodeUrl: ' https://support.example.com/qr.png ',
    }),
    { enabled: true, qrCodeUrl: 'https://support.example.com/qr.png' },
  )
  for (const qrCodeUrl of [
    '',
    'http://example.com/qr.png',
    'javascript:alert(1)',
    'data:image/png;base64,AA',
    '//example.com/qr.png',
    'https://user:password@example.com/qr.png',
    'https://example.com/qr.png#fragment',
  ]) {
    assert.throws(
      () => parseSupportConfiguration({ enabled: true, qrCodeUrl }),
      ApiError,
    )
  }
  assert.throws(
    () =>
      parseSupportConfiguration({
        enabled: true,
        qrCodeUrl: 'https://example.com/qr.png',
        paymentUrl: 'https://example.com/pay',
      }),
    ApiError,
  )
  assert.throws(
    () => parseSupportConfiguration({ enabled: 'true', qrCodeUrl: '' }),
    ApiError,
  )
})

test('disabled customer support does not expose QR URL or admin metadata', async () => {
  let row = {
    enabled: false,
    qrCodeUrl: 'https://example.com/qr.png',
    updatedAt: new Date(),
    updatedBy: 'admin-id',
  }
  const repository = {
    findOneBy: async () => row,
    save: async (value: typeof row) => {
      row = value
    },
  }
  const service = new CustomerSupportService({
    getRepository: () => repository,
  } as unknown as DataSource)
  assert.deepEqual(await service.publicConfiguration(), {
    enabled: false,
    qrCodeUrl: '',
  })
  await service.save(
    { enabled: true, qrCodeUrl: 'https://example.com/new.png' },
    'new-admin',
  )
  assert.equal(row.updatedBy, 'new-admin')
  assert.deepEqual(await service.publicConfiguration(), {
    enabled: true,
    qrCodeUrl: 'https://example.com/new.png',
  })
})

test('customer support endpoint authenticates before reading configuration and is not cached', async () => {
  const app = Fastify()
  let reads = 0
  const config = { enabled: true, qrCodeUrl: 'https://example.com/qr.png' }
  registerCustomerSupport(app, {
    identity: {
      authenticate: async (token: string) => {
        if (token !== 'fixture') {
          throw new ApiError(401, 'UNAUTHENTICATED', '未登录')
        }
      },
    },
    support: {
      publicConfiguration: async () => {
        reads++
        return config
      },
    },
  } as unknown as PlatformService)
  try {
    const denied = await app.inject({ url: '/api/v1/support' })
    assert.equal(denied.statusCode, 401)
    assert.equal(reads, 0)
    const allowed = await app.inject({
      url: '/api/v1/support',
      headers: { authorization: 'Bearer fixture' },
    })
    assert.equal(allowed.statusCode, 200)
    assert.deepEqual(allowed.json(), { data: config })
    assert.equal(allowed.headers['cache-control'], 'no-store')
  } finally {
    await app.close()
  }
})
