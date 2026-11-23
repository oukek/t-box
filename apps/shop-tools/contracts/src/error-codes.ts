import { defineApiErrors } from '@t-box/errors'

const codes = defineApiErrors({
  SHOP_CONFLICT: {
    statusCode: 409,
    message:
      '云端数据已被其他页面或设备修改，请先备份当前工作簿，再重新加载云端数据',
  },
  SHOP_INSTALLATION_CHANGED: {
    statusCode: 403,
    message: '应用安装状态已变化，请重新打开应用',
  },
  SHOP_REPLAY_CONFLICT: {
    statusCode: 409,
    message: '同一保存标识不能用于不同内容',
  },
  SHOP_PROJECT_DENIED: { statusCode: 403, message: '当前账号没有此项目的操作权限' },
  SHOP_INVALID: { statusCode: 400, message: '跨境运营参数无效' },
})
export const ShopError = Object.freeze({
  conflict: () => codes.SHOP_CONFLICT(),
  installation: () => codes.SHOP_INSTALLATION_CHANGED(),
  replay: () => codes.SHOP_REPLAY_CONFLICT(),
  denied: () => codes.SHOP_PROJECT_DENIED(),
  invalid: (message: string) => codes.SHOP_INVALID(message),
})
