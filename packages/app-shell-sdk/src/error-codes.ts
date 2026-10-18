import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('PACKAGES_APP_SHELL_SDK', {
  INTERNAL_HOST_NOT_INITIALIZED: '应用宿主尚未初始化',
  INTERNAL_SHELL_SERVICES_HAVE_ALREADY_BEEN_CONFIGURED:
    'Shell services have already been configured',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
