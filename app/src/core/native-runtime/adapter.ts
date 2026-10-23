import type { DeviceCapability } from '@t-box/app-contracts'
import { Capacitor } from '@capacitor/core'
import { SdkErrorCode } from '@t-box/app-sdk'
import { promptNativeDownload } from './downloads'

const native = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
export const devicePlatform = () => Capacitor.getPlatform() as 'web' | 'ios' | 'android'
export async function nativeDevice() {
  if (!native()) {
    promptNativeDownload('本机设备功能', 'ios')
    throw SdkErrorCode.DEVICE_UNSUPPORTED()
  }
  return (await import('@t-box/capacitor-device-runtime')).DeviceRuntime
}
const grantKey = (scope: string) => `tbox.device-grants.v1.${scope}`
export async function supportedDeviceCapabilities(): Promise<string[]> {
  if (native()) {
    return (await (await nativeDevice()).environment()).capabilities
  }
  if (devicePlatform() !== 'web') {
    return []
  }
  return [...(/iPhone|Android/i.test(navigator.userAgent) ? ['phone.dial'] : []), ...(typeof navigator.share === 'function' ? ['share.present'] : [])]
}
export async function deviceGrants(scope: string): Promise<string[]> {
  if (native()) {
    return (await (await nativeDevice()).permissions({ scope })).capabilities
  }
  try {
    const value: unknown = JSON.parse(localStorage.getItem(grantKey(scope)) || '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
export async function changeDeviceGrant(scope: string, capabilities: DeviceCapability[], allow: boolean) {
  if (native()) {
    const device = await nativeDevice()
    await (allow ? device.grant({ scope, capabilities }) : device.revoke({ scope, capabilities }))
    return
  }
  const values = new Set(await deviceGrants(scope))
  for (const capability of capabilities) {
    if (allow) {
      values.add(capability)
    } else {
      values.delete(capability)
    }
  }
  localStorage.setItem(grantKey(scope), JSON.stringify([...values]))
}
export async function invokeDevice(scope: string, capability: DeviceCapability, args: Record<string, unknown>, requestId: string): Promise<unknown> {
  if (native()) {
    return (await nativeDevice()).invoke({ scope, capability, arguments: args, requestId })
  }
  if (capability === 'phone.dial') {
    location.href = `tel:${encodeURIComponent(String(args.number))}`
    return { status: 'handed_off' }
  }
  if (capability === 'share.present' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: args.title as string | undefined, text: String(args.text) })
      return { status: 'shared' }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        return { status: 'cancelled' }
      }
      throw cause
    }
  }
  throw SdkErrorCode.DEVICE_UNSUPPORTED()
}
