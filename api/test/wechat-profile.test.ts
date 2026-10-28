import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchWechatOpenid, fetchWechatProfile, wechatAvatar } from '../src/identity/wechat-profile.js'

test('Wechat silent authorization validates the OpenID without fetching profile data', async () => {
  let requests = 0
  const transport: typeof fetch = async (input) => {
    requests++
    assert.equal(new URL(String(input)).pathname, '/sns/oauth2/access_token')
    return Response.json({ openid: 'openid_silent_12345', access_token: 'secret_token', scope: 'snsapi_base' })
  }
  assert.equal(await fetchWechatOpenid('wx_fixture', 'secret_app_secret', 'code', transport), 'openid_silent_12345')
  assert.equal(requests, 1)
  for (const token of [{ errcode: 40029 }, { openid: 'short', access_token: 'token', scope: 'snsapi_base' }, { openid: 'openid_fixture_12345', access_token: 'token', scope: 'invalid' }]) {
    await assert.rejects(fetchWechatOpenid('wx_fixture', 'secret_app_secret', 'code', async () => Response.json(token)), /微信授权未完成/)
  }
})

test('Wechat userinfo requires the authorized OpenID and hides upstream credentials on failure', async () => {
  const calls: URL[] = []
  const transport: typeof fetch = async (input) => {
    const url = new URL(String(input))
    calls.push(url)
    return Response.json(url.pathname.endsWith('access_token')
      ? { access_token: 'secret_access_token', openid: 'openid_fixture_12345', scope: 'snsapi_userinfo' }
      : { openid: 'openid_fixture_12345', nickname: '🍀'.repeat(50), headimgurl: 'http://wx.qlogo.cn/fixture/132' })
  }
  const profile = await fetchWechatProfile('wx_fixture', 'secret_app_secret', 'code_fixture', transport)
  assert.equal([...profile.nickname].length, 40)
  assert.equal(profile.avatarUrl, 'https://wx.qlogo.cn/fixture/132')
  assert.equal(calls[1]!.searchParams.get('access_token'), 'secret_access_token')
  const bad: typeof fetch = async () => Response.json({ openid: 'openid_fixture_12345', access_token: 'secret_access_token', scope: 'snsapi_base' })
  await assert.rejects(fetchWechatProfile('wx_fixture', 'secret_app_secret', 'code_fixture', bad), (error: Error) => error.message.includes('微信授权未完成') && !/secret_|api.weixin/.test(error.message))
})

test('Wechat avatars accept official image hosts and exclude unsafe or unrelated URLs', () => {
  for (const value of ['javascript:alert(1)', 'https://example.com/avatar', 'https://wx.qlogo.cn.evil.example/a', 'https://user:pass@wx.qlogo.cn/a', 'https://wx.qlogo.cn:8443/a', 'invalid']) {
    assert.equal(wechatAvatar(value), '')
  }
  assert.equal(wechatAvatar('https://thirdwx.qlogo.cn/mmopen/x/132'), 'https://thirdwx.qlogo.cn/mmopen/x/132')
})
