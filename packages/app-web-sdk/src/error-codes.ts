import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('PACKAGES_APP_WEB_SDK', {
  INTERNAL_HOST_REQUEST_FAILED: '宿主请求失败',
  INTERNAL_APPLICATION_CLOSED: '应用已关闭',
  INTERNAL_HOST_CONNECTION_TIMEOUT: '应用宿主连接超时',
  INTERNAL_INVALID_APPLICATION_REQUEST: '应用请求参数无效或过大',
  INTERNAL_INVALID_HOST_ORIGIN: '应用宿主来源无效',
  INTERNAL_TOOL_NOT_IMPLEMENTED: '应用未提供该工具',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
