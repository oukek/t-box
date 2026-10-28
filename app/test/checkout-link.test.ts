import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkoutTicket } from '../src/features/billing/checkoutLink.ts'
import { usesWechatCheckoutLink } from '../src/features/billing/paymentEnvironment.ts'

test('desktop opens a WeChat checkout link; only the WeChat browser calls JS-SDK', () => {
  assert.equal(usesWechatCheckoutLink(false, 'Macintosh Chrome', false), true)
  assert.equal(usesWechatCheckoutLink(false, 'Windows MicroMessenger WindowsWechat', false), true)
  assert.equal(usesWechatCheckoutLink(false, 'Windows Touch Chrome', true), true)
  assert.equal(usesWechatCheckoutLink(false, 'iPhone MicroMessenger', true), false)
  assert.equal(usesWechatCheckoutLink(true, 'Android', true), false)
  assert.equal(usesWechatCheckoutLink(false, 'Android Chrome', true), false)
  assert.equal(usesWechatCheckoutLink(false, 'Android Chrome', true, 5, ['jsapi']), true)
  assert.equal(usesWechatCheckoutLink(false, 'iPhone Safari', true, 5, ['jsapi']), true)
  assert.equal(usesWechatCheckoutLink(false, 'Android Chrome', true, 5, ['jsapi', 'h5']), false)
})
test('checkout URLs provide only a ticket; clean URLs and duplicated or invalid tickets cannot repeat automatic payment', () => {
  const ticket = 'a'.repeat(64)
  assert.equal(checkoutTicket(`#/pay/wechat?ticket=${ticket}&confirmForOtherUser=1&recipientId=forged`), ticket)
  assert.equal(checkoutTicket('#/pay/wechat'), null)
  assert.equal(checkoutTicket(`#/pay/wechat?ticket=${ticket}&ticket=${ticket}`), null)
  assert.equal(checkoutTicket('#/pay/wechat?ticket=short'), null)
  assert.equal(checkoutTicket(`#/ai/recharge?ticket=${ticket}`), null)
})
