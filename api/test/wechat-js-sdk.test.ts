import type { WechatRuntime } from '../src/payments/configuration.js'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { signWechatPage, WechatJsSdk, wechatPageUrl } from '../src/payments/wechat-js-sdk.js'

test('JS-SDK signs the exact page without the hash, on the configured frontend only', () => {
  const page = 'https://tboxos.cn/?code=fixture&state=example'
  assert.equal(wechatPageUrl(page, 'https://tboxos.cn'), page)
  for (const url of ['https://evil.example/', 'https://tboxos.cn.evil.example/', 'http://tboxos.cn/', 'https://tboxos.cn/#/ai/recharge', 'https://user:pass@tboxos.cn/']) {
    assert.throws(() => wechatPageUrl(url, 'https://tboxos.cn'))
  }
  assert.equal(signWechatPage('ticket', page, 12345, 'nonce'), createHash('sha1').update(`jsapi_ticket=ticket&noncestr=nonce&timestamp=12345&url=${page}`).digest('hex'))
})

test('JS-SDK ticket acquisition coalesces requests, caches, and retries after a provider failure', async () => {
  let count = 0
  let fail = true
  const transport: typeof fetch = async (input, init) => {
    count++
    if (fail) {
      return Response.json({ errcode: 40164, errmsg: 'invalid ip containing private details' })
    }
    if (String(input).endsWith('/stable_token')) {
      assert.equal(JSON.parse(String(init?.body)).force_refresh, false)
      return Response.json({ access_token: 'fixture_access_token' })
    }
    return Response.json({ errcode: 0, ticket: 'fixture_ticket', expires_in: 7200 })
  }
  const sdk = new WechatJsSdk(transport)
  const c = { appId: 'wx_fixture', appSecret: 'fixture_secret', frontendUrl: 'https://tboxos.cn', jsapi: true } as WechatRuntime
  await assert.rejects(sdk.configuration(c, 'https://tboxos.cn/'), (error: Error) => error.message.includes('IP 白名单') && !error.message.includes('private details'))
  fail = false
  const results = await Promise.all([sdk.configuration(c, 'https://tboxos.cn/'), sdk.configuration(c, 'https://tboxos.cn/?code=x')])
  assert.equal(count, 3)
  assert.notEqual(results[0]!.nonceStr, results[1]!.nonceStr)
  assert.equal(results[0]!.signature, signWechatPage('fixture_ticket', 'https://tboxos.cn/', results[0]!.timestamp, results[0]!.nonceStr))
  await sdk.configuration(c, 'https://tboxos.cn/')
  assert.equal(count, 3)
})
