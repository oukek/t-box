import { AppSdkError } from './sdk-error.js'

const definitions = {
  DEVICE_BUSY: '另一个设备操作或授权窗口尚未结束',
  DEVICE_UNSUPPORTED: '当前设备不支持此功能',
  DEVICE_PERMISSION_DENIED: '未授权此应用使用该设备能力',
  DEVICE_RESULT_UNKNOWN: '设备操作结果尚待核对，请勿重复提交',
  DEVICE_REQUEST_CONFLICT: '同一请求标识不能用于不同操作',
  DEVICE_EVENT_NOT_FOUND: '系统日历事件不存在或已被删除',
  DEVICE_FOREGROUND_REQUIRED: '请打开应用后继续此操作',
  MARKET_HIDDEN: '应用市场已关闭，暂不支持自行安装应用',
  EVENT_FAILED: '应用事件订阅失败',
  REQUEST_FAILED: '应用请求失败',
  API_SCOPE_DENIED: '应用未注册此接口范围',
  APP_CLOSED: '应用已关闭',
  APP_NOT_REGISTERED: '应用未注册',
  APP_RUNTIME_EXPIRED: '应用安装状态已改变，请重新打开',
  AUTH_REQUIRED: '请在宿主中登录后使用应用',
  CAPABILITY_UNAVAILABLE: '此应用没有该宿主能力',
  CUSTOM_UPDATE_PROMPT_DISABLED: '此已安装版本使用系统更新提示',
  EVENT_AUTH_FAILED: '事件连接授权失效，请重新打开应用',
  FILE_PICKER_BUSY: '已有文件选择窗口打开',
  FILE_SIZE: '每个文件需为 1 字节至 10 MB',
  INVALID_API_PATH: '应用接口路径无效',
  INVALID_ARGUMENTS: '应用接口只接受 JSON 参数',
  INVALID_RESOURCE_BINDING: '应用资源绑定无效',
  INVALID_STORAGE_KEY: '应用存储键无效',
  INVALID_STORAGE_VALUE: '存储内容无效或过大',
  INVALID_SUBSCRIPTION: '事件订阅无效或过多',
  INVALID_TIMEOUT: '请求超时时间无效',
  NAVIGATION_DENIED: '只有当前应用可以打开更新页面',
  NETWORK_REQUIRED: '此操作需要联网，请连接网络后重试',
  APP_UPDATE_REQUIRED: '此功能需要登录并在应用市场完成更新后使用',
  PERMISSION_DENIED: '应用未授权此事件通道',
  PROTOCOL_MISMATCH: '应用 SDK 协议不兼容',
  REQUEST_CANCELLED: '请求已取消',
  REQUEST_TIMEOUT: '请求超时；写入结果可能尚待确认',
  SESSION_CHANGED: '登录状态已改变，请重新操作',
  TRUSTED_RUNTIME_REQUIRED: '此接口仅供内置应用使用',
  UPDATE_PROMPT_REGISTERED: '已注册更新提示处理器',
} as const

/** Bridge protocol codes are owned by the SDK, never repeated by host/apps. */
export const SdkErrorCode = Object.freeze(
  Object.fromEntries(
    Object.entries(definitions).map(([code, text]) => [
      code,
      (message = text, status?: number) =>
        new AppSdkError(code, message, status),
    ]),
  ),
) as {
  readonly [K in keyof typeof definitions]: (
    message?: string,
    status?: number,
  ) => AppSdkError
}
