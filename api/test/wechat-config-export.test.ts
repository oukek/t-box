import type { DataSource } from 'typeorm'
import type { ConfigurationService } from '../src/admin/service.js'
import type { PlatformService } from '../src/platform/service.js'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import Fastify from 'fastify'
import { createVault } from '../src/admin/crypto.js'
import { registerAdmin } from '../src/admin/routes.js'
import { PaymentConfiguration } from '../src/payments/configuration.js'

test('WeChat export requires a configured independent key and exports decrypted credentials without caching', async (t) => {
  const previousKey = process.env.WECHAT_CONFIG_EXPORT_KEY
  t.after(() => {
    if (previousKey === undefined) delete process.env.WECHAT_CONFIG_EXPORT_KEY
    else process.env.WECHAT_CONFIG_EXPORT_KEY = previousKey
  })
  delete process.env.WECHAT_CONFIG_EXPORT_KEY
  const vault = createVault(randomBytes(32))
  const secrets = { privateKey: 'fixture-private-key', apiV3Key: 'fixture-api-v3-key', appSecret: 'fixture-app-secret' }
  const query = {
    select() { return this },
    from() { return this },
    innerJoin() { return this },
    where() { return this },
    setParameters() { return this },
    async getRawMany() { return [{ id: 'administrator', username: 'admin' }] },
    async getRawOne() {
      return { id: 'config', public_json: { appId: 'wx-fixture', merchantId: '123456' }, secret_cipher: vault.encrypt(JSON.stringify(secrets)) }
    },
  }
  const source = { createQueryBuilder: () => query } as unknown as DataSource
  const paymentConfiguration = new PaymentConfiguration(source, vault)
  const service = { store: { source, queryBuilder: () => query } } as unknown as ConfigurationService
  const platform = {
    paymentConfiguration,
    promotions: {},
    calendar: {},
    applications: {},
  } as unknown as PlatformService
  const app = Fastify()
  t.after(() => app.close())
  registerAdmin(app, service, platform, ['https://admin.example.com'])
  const url = '/api/v1/admin/payments/wechat/export'
  const cookie = `tbox_admin=${'a'.repeat(64)}`
  const headers = { 'x-admin-request': '1', authorization: `Bearer ${'b'.repeat(64)}` }

  const disabled = await app.inject({ method: 'POST', url, headers })
  assert.equal(disabled.statusCode, 404)
  process.env.WECHAT_CONFIG_EXPORT_KEY = 'short'
  const weak = await app.inject({ method: 'POST', url, headers })
  assert.equal(weak.statusCode, 404)
  process.env.WECHAT_CONFIG_EXPORT_KEY = 'b'.repeat(64)

  const anonymous = await app.inject({ method: 'POST', url, headers: { 'x-admin-request': '1' } })
  assert.notEqual(anonymous.statusCode, 200)
  assert.ok(!anonymous.body.includes(secrets.privateKey))
  const wrong = await app.inject({ method: 'POST', url, headers: { ...headers, authorization: 'Bearer incorrect' } })
  assert.notEqual(wrong.statusCode, 200)
  const sessionOnly = await app.inject({ method: 'POST', url, headers: { 'x-admin-request': '1', cookie } })
  assert.notEqual(sessionOnly.statusCode, 200)
  const csrf = await app.inject({ method: 'POST', url, headers: { authorization: headers.authorization } })
  assert.notEqual(csrf.statusCode, 200)
  const foreign = await app.inject({ method: 'POST', url, headers: { ...headers, origin: 'https://untrusted.example' } })
  assert.notEqual(foreign.statusCode, 200)
  const response = await app.inject({ method: 'POST', url, headers })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.match(String(response.headers['content-disposition']), /attachment/)
  for (const [key, value] of Object.entries(secrets)) assert.equal(response.json().data[key], value)
  assert.equal(response.json().data.merchantId, '123456')

  const view = await app.inject({ url: '/api/v1/admin/payments/wechat', headers: { cookie } })
  assert.equal(view.statusCode, 200)
  for (const key of Object.keys(secrets)) assert.ok(!(key in view.json().data))
  delete process.env.WECHAT_CONFIG_EXPORT_KEY
  const revoked = await app.inject({ method: 'POST', url, headers })
  assert.equal(revoked.statusCode, 404)
})
