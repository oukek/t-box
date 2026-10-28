import type { WechatLoginFlow } from '@t-box/shared'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import sharp from 'sharp'
import { createVault, digest } from '../src/admin/crypto.js'
import { createApp } from '../src/app.js'
import { createDataSource } from '../src/db/data-source.js'
import { NativeActionSessions } from '../src/identity/native-sessions.js'
import { WechatAccountConfiguration } from '../src/identity/wechat-configuration.js'
import { WechatAccountEntity, WechatFlowEntity } from '../src/identity/wechat-entities.js'
import { WechatLoginService } from '../src/identity/wechat-login.js'
import { PlatformService } from '../src/platform/service.js'
import { assertDisposableDatabase, cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
assertDisposableDatabase(source.options.database)
const vault = createVault(randomBytes(32))
const configuration = new WechatAccountConfiguration(source, vault)
const platform = new PlatformService(source, undefined, undefined, undefined, undefined, undefined, undefined, configuration)
const users = new Set<string>()
const wxNickname = '微信昵称 🍀'
const wxAvatar = 'https://wx.qlogo.cn/fixture/avatar/132'
let exchanges = 0
let profileRequests = 0
const transport: typeof fetch = async (input) => {
  const url = new URL(String(input))
  if (url.pathname === '/sns/oauth2/access_token') {
    exchanges++
    assert.equal(url.searchParams.get('secret'), 'fixtureSecret1234567890')
    const code = url.searchParams.get('code')
    if (code === 'denied') {
      return Response.json({ errcode: 40029 })
    }
    return Response.json({ openid: `openid_${code?.includes('other') ? 'other' : 'fixture'}_123456789`, access_token: `access_${code}`, scope: code?.startsWith('silent') ? 'snsapi_base' : 'snsapi_userinfo' })
  }
  assert.equal(url.pathname, '/sns/userinfo')
  profileRequests++
  return Response.json({ openid: url.searchParams.get('openid'), nickname: '微信昵称 🍀', headimgurl: 'http://wx.qlogo.cn/fixture/avatar/132' })
}
const service = new WechatLoginService(configuration, platform.identity, transport)
Object.assign(platform, { wechatLogin: service })
const app = createApp({ platform, bills: {} as any, health: async () => ({ mysql: 'up', redis: 'down' }), taskWorker: false })
const sockets: Awaited<ReturnType<typeof app.injectWS>>[] = []
const account = { enabled: true, appId: 'wx1234567890abcdef', appSecret: 'fixtureSecret1234567890', frontendUrl: 'https://tboxos.cn', revision: 0 }
const secret = () => randomBytes(32).toString('hex')
async function start(kind: WechatLoginFlow['kind'], parentId?: string, silent = false) {
  const proof = secret()
  const flow = await service.start({ kind, secret: proof, ...(parentId ? { parentId } : {}), ...(silent ? { silent: true } : {}) }, randomUUID(), kind === 'qr' ? 'Mac · Chrome' : 'iPhone · 微信')
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
  const legacy = await platform.identity.register({ username: `legacy_${randomUUID().replaceAll('-', '')}`, password: 'test123' }, randomUUID())
  users.add(legacy.user.id)
  const rejected = await app.inject({ url: '/api/v1/auth/me', headers: { authorization: `Bearer ${legacy.token}` } })
  assert.equal(rejected.statusCode, 401, 'A previously valid password login must be rejected by the production WeChat policy')
  await assert.rejects(platform.identity.authenticateHash(digest(legacy.token)), /微信重新登录/, 'Socket and native callers must enforce the same policy')
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
  assert.equal(direct.user!.nickname, wxNickname)
  assert.equal(direct.user!.avatarUrl, wxAvatar)
  const principal = await platform.identity.authenticate(direct.session!.token)
  const nativeSessions = new NativeActionSessions(platform.identity)
  const native = await nativeSessions.issue(direct.session!.token, {})
  assert.equal((await nativeSessions.authenticate(native.token)).user.id, principal.user.id)
  await nativeSessions.revoke(native.token)
  assert.equal(principal.user.avatarUrl, wxAvatar)
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
  assert.equal(scanned.session, undefined, 'Scanning alone cannot issue either device session')
  assert.equal((await poll(qr)).session, undefined, 'Scanning alone does not log in the desktop')
  assert.equal(scanned.user!.id, direct.user!.id, 'The same WeChat identity on another device restores the same account')
  assert.equal(scanned.user!.nickname, wxNickname, 'A successful profile authorization replaces the station nickname')
  assert.equal(scanned.user!.avatarUrl, wxAvatar, 'A successful profile authorization replaces the station avatar')
  assert.equal((await app.inject({ url: avatarUrl })).statusCode, 404, 'An uploaded avatar replaced by WeChat is no longer publicly served')
  const confirmations = await Promise.all([0, 1].map(() => service.confirm({ id: scan.id, secret: scan.secret, approve: true })))
  await pushed('complete')
  assert.ok(updates.find((event) => event.data?.status === 'complete')?.data.session?.token)
  assert.ok(confirmations.every((item) => item.status === 'complete' && item.session))
  const desktop = (await poll(qr)).session!
  const phone = confirmations[0]!.session!
  assert.equal(confirmations[1]!.session!.token, phone.token, 'Concurrent confirmations recover the same phone session')
  assert.equal((await poll(scan)).session!.token, phone.token, 'The phone can recover its own session after a lost confirmation response')
  assert.notEqual(phone.token, desktop.token, 'The phone must never receive the desktop token')
  assert.notEqual(phone.token, direct.session!.token)
  assert.equal((await platform.identity.authenticate(phone.token)).user.id, direct.user!.id)
  assert.equal((await poll(qr)).session!.token, desktop.token)
  assert.notEqual(desktop.token, direct.session!.token)
  assert.equal((await platform.identity.authenticate(desktop.token)).user.id, direct.user!.id)
  const sessions = await platform.accountSecurity.sessions(principal)
  assert.equal(sessions.length, 3, 'Concurrent confirmations issue exactly one desktop and one phone session')
  assert.ok(sessions.some((session) => session.device === 'Mac · Chrome'))
  await platform.identity.logout(await platform.identity.authenticate(phone.token))
  await assert.rejects(platform.identity.authenticate(phone.token), /登录|会话/)
  assert.equal((await platform.identity.authenticate(desktop.token)).user.id, direct.user!.id, 'Revoking the phone session does not revoke the desktop')

  const cancelled = await start('qr')
  const cancelledScan = await start('scan', cancelled.id)
  await exchange(cancelledScan)
  await service.confirm({ id: cancelledScan.id, secret: cancelledScan.secret, approve: false })
  assert.equal((await poll(cancelled)).status, 'cancelled')
  assert.equal((await poll(cancelled)).session, undefined)
  assert.equal((await poll(cancelledScan)).session, undefined, 'Rejecting confirmation issues no phone session')
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
  assert.equal(me.json().data.avatarUrl, wxAvatar)
  assert.equal((await platform.billing.users(wxNickname))[0]!.avatarUrl, wxAvatar, 'The administration user list includes the authorized WeChat avatar and nickname')
  const reset = await app.inject({ method: 'DELETE', url: '/api/v1/auth/avatar', headers: { authorization: `Bearer ${desktop.token}` } })
  assert.equal(reset.statusCode, 200)
  assert.equal(reset.json().data.avatarUrl, '')
  assert.equal((await app.inject({ url: avatarUrl })).statusCode, 404)
  const wrongPoll = await app.inject({ method: 'POST', url: '/api/v1/auth/wechat/poll', payload: { id: qr.id, secret: secret() } })
  assert.equal(wrongPoll.statusCode, 410)
  assert.equal(wrongPoll.headers['cache-control'], 'no-store')

  await platform.identity.updateProfile(principal, { nickname: '静默阶段保留' })
  const customAvatar = await app.inject({ method: 'POST', url: '/api/v1/auth/avatar', headers: { 'authorization': `Bearer ${direct.session!.token}`, 'content-type': 'application/octet-stream' }, payload: png })
  assert.equal(customAvatar.statusCode, 200, customAvatar.body)
  const silent = await start('login', undefined, true)
  assert.equal(new URL(silent.authorizationUrl!).searchParams.get('scope'), 'snsapi_base')
  const silentProof = { id: silent.id, secret: silent.secret }
  await assert.rejects(service.authorizeProfile(silentProof), /无效/, 'Profile authorization cannot skip the silent identity check')
  const usersBeforeSilent = await source.getRepository(AppUserEntity).count()
  const profilesBeforeSilent = profileRequests
  const identified = await exchange(silent, 'silent')
  assert.equal(identified.requiresProfileAuthorization, true)
  assert.equal(identified.session, undefined)
  assert.equal(identified.user, undefined)
  assert.equal(JSON.stringify(identified).includes('openid'), false, 'The silent identity stays on the server')
  assert.equal(profileRequests, profilesBeforeSilent, 'Silent identification never calls userinfo')
  assert.equal(await source.getRepository(AppUserEntity).count(), usersBeforeSilent, 'Silent identification alone never creates an account')
  const afterSilent = await platform.identity.authenticate(direct.session!.token)
  assert.equal(afterSilent.user.nickname, '静默阶段保留', 'Silent identification never overwrites a nickname')
  assert.equal(afterSilent.user.avatarUrl, customAvatar.json().data.avatarUrl, 'Silent identification never overwrites an avatar')
  assert.equal((await poll(silent)).requiresProfileAuthorization, true, 'Reloading can recover the consent prompt')
  await assert.rejects(service.authorizeProfile({ id: silent.id, secret: secret() }), /失效/)
  const consentReply = await app.inject({ method: 'POST', url: '/api/v1/auth/wechat/authorize-profile', payload: silentProof })
  assert.equal(consentReply.statusCode, 200, consentReply.body)
  const consent = { ...silent, ...consentReply.json().data }
  assert.notEqual(consent.state, silent.state)
  assert.equal(new URL(consent.authorizationUrl!).searchParams.get('scope'), 'snsapi_userinfo')
  assert.equal(new URL(consent.authorizationUrl!).searchParams.get('redirect_uri'), 'https://tboxos.cn/')
  await assert.rejects(exchange(silent, 'fixture'), /无效/, 'The silent callback state cannot authorize the profile stage')
  const authorized = await exchange(consent)
  assert.ok(authorized.session)
  assert.equal(authorized.user!.id, direct.user!.id)
  assert.equal(authorized.user!.nickname, wxNickname, 'The profile stage replaces the nickname only after authorization succeeds')
  assert.equal(authorized.user!.avatarUrl, wxAvatar)
  assert.equal((await exchange(consent)).session!.token, authorized.session!.token)

  const mismatch = await start('login', undefined, true)
  await exchange(mismatch, 'silent')
  const mismatchConsent = { ...mismatch, ...await service.authorizeProfile({ id: mismatch.id, secret: mismatch.secret }) }
  await assert.rejects(exchange(mismatchConsent, 'other'), /账号不一致/)
  assert.equal((await poll(mismatch)).status, 'failed')
  assert.equal((await poll(mismatch)).session, undefined)

  const silentQr = await start('qr')
  const silentScan = await start('scan', silentQr.id, true)
  assert.equal((await exchange(silentScan, 'silent')).requiresProfileAuthorization, true)
  assert.equal((await poll(silentQr)).session, undefined)
  const scanConsent = { ...silentScan, ...await service.authorizeProfile({ id: silentScan.id, secret: silentScan.secret }) }
  assert.equal((await exchange(scanConsent)).status, 'scanned')
  assert.equal((await poll(silentQr)).session, undefined, 'Profile consent still requires explicit desktop login confirmation')
  const mobileConfirmation = await service.confirm({ id: silentScan.id, secret: silentScan.secret, approve: true })
  assert.ok(mobileConfirmation.session)
  assert.notEqual(mobileConfirmation.session!.token, (await poll(silentQr)).session!.token)

  const silentExpired = await start('login', undefined, true)
  await exchange(silentExpired, 'silent')
  await source.getRepository(WechatFlowEntity).update({ id: silentExpired.id }, { expiresAt: new Date(Date.now() - 1) })
  await assert.rejects(service.authorizeProfile({ id: silentExpired.id, secret: silentExpired.secret }), /失效/)
  await source.getRepository(AppUserEntity).update({ id: direct.user!.id }, { enabled: false })
  await assert.rejects(poll(qr), /停用/)
  console.log('Wechat login integration passed: silent identification, explicit profile consent, same-account verification, browser proof/state, QR confirmation, concurrent claims, idempotent delivery, expiry/revocation and payment OpenID reuse.')
} finally {
  sockets.forEach((socket) => socket.terminate())
  await app.close()
  await source.query('DELETE FROM wechat_login_flows')
  await cleanupUsers(source, [...users])
  await source.getRepository(WechatAccountEntity).clear()
  await source.destroy()
}
