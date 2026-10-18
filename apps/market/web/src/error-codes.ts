import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('APPS_MARKET_WEB', {
  INTERNAL_INVALID_MARKET_NAVIGATION: '应用市场导航参数无效',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
