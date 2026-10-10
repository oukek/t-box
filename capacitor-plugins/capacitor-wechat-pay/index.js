import { registerPlugin } from '@capacitor/core'

export const WechatPay = registerPlugin('TBoxWechatPay', {
  web: () => import('./web.js').then((m) => new m.WechatPayWeb()),
})
