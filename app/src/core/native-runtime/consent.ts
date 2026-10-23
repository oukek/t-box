import type { DeviceCapability } from '@t-box/app-contracts'
import { SdkErrorCode } from '@t-box/app-sdk'
import { shallowReactive } from 'vue'

export const deviceConsent = shallowReactive<{ current: { appName: string, description?: string, capabilities: DeviceCapability[], resolve(allowed: boolean): void } | null }>({ current: null })
/** System permission dialogs and our app-scoped consent must never overlap. */
export async function requestDeviceConsent(appName: string, capabilities: DeviceCapability[], signal?: AbortSignal) {
  if (signal?.aborted) {
    throw SdkErrorCode.REQUEST_CANCELLED()
  }
  if (deviceConsent.current) {
    throw SdkErrorCode.DEVICE_BUSY()
  }
  return new Promise<boolean>((resolve) => {
    let settled = false
    const abort = () => finish(false)
    function finish(allowed: boolean) {
      if (settled) {
        return
      }
      settled = true
      signal?.removeEventListener('abort', abort)
      deviceConsent.current = null
      resolve(allowed)
    }
    signal?.addEventListener('abort', abort, { once: true })
    deviceConsent.current = { appName, capabilities, resolve: finish }
  })
}

export async function requestActionConsent(title: string, action: string, writes: boolean, signal?: AbortSignal) {
  if (signal?.aborted) {
    throw SdkErrorCode.REQUEST_CANCELLED()
  }
  if (deviceConsent.current) {
    throw SdkErrorCode.DEVICE_BUSY()
  }
  return new Promise<boolean>((resolve) => {
    let settled = false
    const abort = () => finish(false)
    function finish(allowed: boolean) {
      if (settled) {
        return
      }
      settled = true
      signal?.removeEventListener('abort', abort)
      deviceConsent.current = null
      resolve(allowed)
    }
    signal?.addEventListener('abort', abort, { once: true })
    deviceConsent.current = { appName: title, capabilities: [], description: `保存后，可从系统快捷指令执行“${action}”。${writes ? '该动作会写入应用数据，运行时会按本次配置执行，请确认参数。' : '运行时返回计算或查询结果。'}云端动作需要联网和有效登录。`, resolve: finish }
  })
}
