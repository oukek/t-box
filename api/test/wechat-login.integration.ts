import type { WechatLoginFlow } from '@t-box/shared'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import sharp from 'sharp'
import { createVault } from '../src/admin/crypto.js'
import { createApp } from '../src/app.js'
import { createDataSource } from '../src/db/data-source.js'
import { WechatAccountConfiguration } from '../src/identity/wechat-configuration.js'
import { WechatAccountEntity, WechatFlowEntity } from '../src/identity/wechat-entities.js'
import { WechatLoginService } from '../src/identity/wechat-login.js'
import { PlatformService } from '../src/platform/service.js'
import { assertDisposableDatabase, cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
assertDisposableDatabase(source.options.database)
const vault = createVault(randomBytes(32))
const configuration = new WechatAccountConfiguration(source, vault)
const platform = new PlatformService(source)
const users = new Set<string>()
let exchanges = 0
const transport: typeof fetch = async (input) => {
  const url = new URL(String(input))
  if (url.pathname === '/sns/oauth2/access_token') {
    exchanges++
    assert.equal(url.searchParams.get('secret'), 'fixtureSecret1234567890')
    const code = url.searchParams.get('code')
    if (code === 'denied') {
      return Response.json({ errcode: 40029 })
    }
    return Response.json({ openid: `openid_${code === 'other' ? 'other' : 'fixture'}_123456789`, access_token: `access_${code}`, scope: 'snsapi_userinfo' })
  }
  assert.equal(url.pathname, '/sns/userinfo')
  return Response.json({ openid: url.searchParams.get('openid'), nickname: '微信昵称 🍀', headimgurl: 'http://wx.qlogo.cn/fixture/avatar/132' })
}
const service = new WechatLoginService(configuration, platform.identity, transport)
Object.assign(platform, { wechatLogin: service })
const app = createApp({ platform, bills: {} as any, health: async () => ({ mysql: 'up', redis: 'down' }), taskWorker: false })
const sockets: Awaited<ReturnType<typeof app.injectWS>>[] = []
const account = { enabled: true, appId: 'wx1234567890abcdef', appSecret: 'fixtureSecret1234567890', frontendUrl: 'https://tboxos.cn', revision: 0 }
const secret = () => randomBytes(32).toString('hex')
async function start(kind: WechatLoginFlow['kind'], parentId?: string) {
  const proof = secret()
  const flow = await service.start({ kind, secret: proof, ...(parentId ? { parentId } : {}) }, randomUUID(), kind === 'qr' ? 'Mac · Chrome' : 'iPhone · 微信')
  return { ...flow, secret: proof }
}
async function exchange(flow: Awaited<ReturnType<typeof start>>, code = 'fixture') {
  const result = await service.exchange({ id: flow.id, secret: flow.secret, state: flow.state, code })
  if (result.user) {
    users.add(result.user.id)
  }
  return result
}
async function poll(flow: Awaited<ReturnType<typeof start>>) {
  return service.poll({ id: flow.id, secret: flow.secret })
}

try {
  await assert.rejects(start('login'), /尚未开放/)
  const saved = await configuration.save(account, randomUUID())
  await assert.rejects(service.start({ kind: { toString: 'login' }, secret: secret() }, randomUUID(), 'fixture'), /无效/)
  assert.equal(saved.hasAppSecret, true)
  assert.equal('appSecret' in saved, false)
  await assert.rejects(configuration.save(account, randomUUID()), /已更新/)
  const [stored] = await source.query('SELECT app_secret_cipher FROM wechat_account_settings')
  assert.equal(stored.app_secret_cipher.includes(account.appSecret), false)
  const login = await start('login')
  const authorization = new URL(login.authorizationUrl!)
  assert.equal(authorization.searchParams.get('scope'), 'snsapi_userinfo')
  assert.equal(authorization.searchParams.get('redirect_uri'), 'https://tboxos.cn/')
  assert.equal(authorization.href.includes(login.secret), false)
  await assert.rejects(service.exchange({ id: login.id, secret: secret(), state: login.state, code: 'fixture' }), /已失效/)
  await assert.rejects(service.exchange({ id: login.id, secret: login.secret, state: secret().slice(0, 48), code: 'fixture' }), /无效/)
  assert.equal((await poll(login)).status, 'pending', 'Invalid proof/state cannot consume another browser authorization')
  const direct = await exchange(login)
  assert.ok(direct.session)
  assert.equal(direct.user!.nickname, '方舟')
  assert.equal(direct.user!.avatarUrl, '')
  const principal = await platform.identity.authenticate(direct.session!.token)
  assert.ok(!principal.user.avatarUrl)
  await platform.identity.updateProfile(principal, { nickname: '我的昵称' })
  const png = await sharp({ create: { width: 20, height: 12, channels: 4, background: '#527f70' } }).png().toBuffer()
  const avatarReply = await app.inject({ method: 'POST', url: '/api/v1/auth/avatar', headers: { 'authorization': `Bearer ${direct.session!.token}`, 'content-type': 'application/octet-stream' }, payload: png })
  assert.equal(avatarReply.statusCode, 200, avatarReply.body)
  const avatarUrl = avatarReply.json().data.avatarUrl as string
  const avatar = await app.inject({ url: avatarUrl })
  assert.equal(avatar.statusCode, 200)
  assert.equal(avatar.headers['content-type'], 'image/webp')
  assert.equal((await sharp(avatar.rawPayload).metadata()).width, 256)
  const invalidAvatar = await app.inject({ method: 'POST', url: '/api/v1/auth/avatar', headers: { 'authorization': `Bearer ${direct.session!.token}`, 'content-type': 'application/octet-stream' }, payload: Buffer.from('<svg onload="alert(1)"/>') })
  assert.equal(invalidAvatar.statusCode, 400)
  assert.equal((await platform.ledgers.list(principal)).length, 1, 'Wechat accounts get the same initial ledger as other identities')
  const paymentBinding = await source.query('SELECT openid_cipher FROM payment_wechat_users WHERE user_id=? AND app_id=?', [direct.user!.id, account.appId])
  assert.equal(vault.decrypt(paymentBinding[0].openid_cipher), 'openid_fixture_123456789')
  const repeated = await exchange(login)
  assert.equal(repeated.session!.token, direct.session!.token, 'Lost responses can recover the same session without reusing a WeChat code')
  assert.equal(exchanges, 1)

  const qr = await start('qr')
  assert.equal(new URL(qr.qrUrl!).searchParams.get('wechatScan'), qr.id)
  assert.equal(qr.qrUrl!.includes(qr.secret), false)
  await app.ready()
  const socket = await app.injectWS('/api/v1/qr/ws')
  sockets.push(socket)
  const updates: { type: string, data: { status: string, session?: { token: string } } }[] = []
  socket.on('message', (data) => updates.push(JSON.parse(data.toString())))
  socket.send(JSON.stringify({ type: 'login', id: qr.id, secret: qr.secret }))
  async function pushed(status: string) {
    const deadline = Date.now() + 2500
    while (!updates.some((event) => event.data?.status === status)) {
      assert.ok(Date.now() < deadline, `Login ${status} was not pushed`)
      await pause(10)
    }
  }
  await pushed('pending')
  const scan = await start('scan', qr.id)
  const scanned = await exchange(scan)
  assert.equal(scanned.status, 'scanned')
  await pushed('scanned')
  assert.equal(scanned.device, 'Mac · Chrome')
  assert.equal(scanned.session, undefined, 'The scanning phone must never receive the desktop token')
  assert.equal((await poll(qr)).session, undefined, 'Scanning alone does not log in the desktop')
  assert.equal(scanned.user!.id, direct.user!.id, 'The same WeChat identity on another device restores the same account')
  assert.equal(scanned.user!.nickname, '我的昵称', 'Wechat profile refresh never overwrites the customized nickname')
  assert.equal(scanned.user!.avatarUrl, avatarUrl, 'Wechat profile refresh never overwrites the customized avatar')
  const confirmations = await Promise.all([0, 1].map(() => service.confirm({ id: scan.id, secret: scan.secret, approve: true })))
  await pushed('complete')
  assert.ok(updates.find((event) => event.data?.status === 'complete')?.data.session?.token)
  assert.ok(confirmations.every((item) => item.status === 'complete' && !item.session))
  const desktop = (await poll(qr)).session!
  assert.equal((await poll(qr)).session!.token, desktop.token)
  assert.notEqual(desktop.token, direct.session!.token)
  assert.equal((await platform.identity.authenticate(desktop.token)).user.id, direct.user!.id)
  const sessions = await platform.accountSecurity.sessions(principal)
  assert.equal(sessions.length, 2, 'Concurrent confirmations issue only one desktop session')
  assert.ok(sessions.some((session) => session.device === 'Mac · Chrome'))

  const cancelled = await start('qr')
  const cancelledScan = await start('scan', cancelled.id)
  await exchange(cancelledScan)
  await service.confirm({ id: cancelledScan.id, secret: cancelledScan.secret, approve: false })
  assert.equal((await poll(cancelled)).status, 'cancelled')
  assert.equal((await poll(cancelled)).session, undefined)
  await assert.rejects(service.confirm({ id: cancelledScan.id, secret: cancelledScan.secret, approve: true }), /取消|扫描/)

  const race = await start('qr')
  const scans = await Promise.all([start('scan', race.id), start('scan', race.id)])
  const raced = await Promise.allSettled(scans.map((flow) => exchange(flow)))
  assert.equal(raced.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(raced.filter((item) => item.status === 'rejected').length, 1)
  await service.cancel({ id: race.id, secret: race.secret })
  const expired = await start('qr')
  await source.getRepository(WechatFlowEntity).update({ id: expired.id }, { expiresAt: new Date(Date.now() - 1000) })
  await assert.rejects(poll(expired), /已失效/)
  const denied = await start('login')
  await assert.rejects(exchange(denied, 'denied'), /授权未完成/)
  assert.equal((await poll(denied)).status, 'failed')

  for (const path of ['register', 'login', 'password-recovery', 'recovery-codes']) {
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/auth/${path}`, payload: {} })).statusCode, 404)
  }
  const me = await app.inject({ url: '/api/v1/auth/me', headers: { authorization: `Bearer ${desktop.token}` } })
  assert.equal(me.json().data.avatarUrl, avatarUrl)
  assert.equal((await platform.billing.users('我的昵称'))[0]!.avatarUrl, avatarUrl, 'The administration user list includes the customized avatar and nickname')
  const reset = await app.inject({ method: 'DELETE', url: '/api/v1/auth/avatar', headers: { authorization: `Bearer ${desktop.token}` } })
  assert.equal(reset.statusCode, 200)
  assert.equal(reset.json().data.avatarUrl, '')
  assert.equal((await app.inject({ url: avatarUrl })).statusCode, 404)
  const wrongPoll = await app.inject({ method: 'POST', url: '/api/v1/auth/wechat/poll', payload: { id: qr.id, secret: secret() } })
  assert.equal(wrongPoll.statusCode, 410)
  assert.equal(wrongPoll.headers['cache-control'], 'no-store')
  await source.getRepository(AppUserEntity).update({ id: direct.user!.id }, { enabled: false })
  await assert.rejects(poll(qr), /停用/)
  console.log('Wechat login integration passed: authorized profiles, browser proof/state, QR confirmation, concurrent claims, idempotent delivery, expiry/revocation, initial ledger and payment OpenID reuse; Redis is not required.')
} finally {
  sockets.forEach((socket) => socket.terminate())
  await app.close()
  await source.getRepository(WechatFlowEntity).clear()
  await cleanupUsers(source, [...users])
  await source.getRepository(WechatAccountEntity).clear()
  await source.destroy()
}
