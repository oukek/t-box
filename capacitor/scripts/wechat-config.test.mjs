import assert from 'node:assert/strict'
import { test } from 'node:test'
import { association, iosWechatPlist, validateWechatConfig } from './wechat-config.mjs'

const configured = { enabled: true, appId: 'wx1234567890123456', iosTeamId: 'ABCDEFGHIJ', universalLink: 'https://app.example.com/wechat/' }
test('native payment stays disabled until valid public identities; reject secret keys and unsafe Universal Links', () => {
  assert.equal(validateWechatConfig({ enabled: false, appId: '', universalLink: '', iosTeamId: '' }).enabled, false)
  assert.throws(() => validateWechatConfig({ ...configured, appId: '' }))
  assert.throws(() => validateWechatConfig({ ...configured, apiV3Key: 'private' }))
  for (const u of ['http://app.example.com/wechat/', 'https://app.example.com/', 'https://app.example.com/wechat', 'https://app.example.com/wechat/?q=1', 'https://app.example.com/wechat/*/', 'https://127.0.0.1/wechat/']) {
    assert.throws(() => validateWechatConfig({ ...configured, universalLink: u }))
  }
})
test('iOS scheme rotation preserves other URL handlers; generated AASA scopes the compiled Bundle ID and path', () => {
  const config = validateWechatConfig(configured)
  const source = { CFBundleURLTypes: [{ CFBundleURLName: 'other', CFBundleURLSchemes: ['other'] }, { CFBundleURLName: 'com.tbox.wechatpay', CFBundleURLSchemes: ['wxold'] }], LSApplicationQueriesSchemes: ['other'] }
  const info = iosWechatPlist(source, config)
  assert.deepEqual(info.CFBundleURLTypes.map((t) => t.CFBundleURLSchemes), [['other'], [configured.appId]])
  assert.deepEqual(info.LSApplicationQueriesSchemes, ['weixin', 'weixinULAPI', 'weixinURLParamsAPI', 'other'])
  assert.deepEqual(iosWechatPlist(info, config), info)
  assert.deepEqual(association(config, 'com.tbox.app').applinks.details, [{ appID: 'ABCDEFGHIJ.com.tbox.app', paths: ['/wechat/*'] }])
  assert.deepEqual(association({ ...config, enabled: false }, 'com.tbox.app').applinks.details, [])
})
