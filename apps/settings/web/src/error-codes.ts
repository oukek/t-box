import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('APPS_SETTINGS_WEB', {
  INTERNAL_INVALID_SETTINGS_NAVIGATION: '设置应用不接受导航参数',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
