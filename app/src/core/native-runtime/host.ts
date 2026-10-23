import type { ApplicationContext, DeviceCapability, DeviceEnvironment, HostMethod } from '@t-box/app-contracts'
import { DEVICE_PROTOCOL_VERSION, deviceCapabilities, deviceCapabilityLabels } from '@t-box/app-contracts'
import { SdkErrorCode } from '@t-box/app-sdk'
import { changeDeviceGrant, deviceGrants, devicePlatform, invokeDevice, supportedDeviceCapabilities } from './adapter'
import { requestDeviceConsent } from './consent'
import { promptNativeDownload } from './downloads'
import { deviceObject, parseDeviceCapabilities, parseDeviceCapability, parseDeviceInput } from './validation'

export const deviceHostMethods: readonly HostMethod[] = ['device.capabilities', 'device.permissions.request', 'device.permissions.revoke', 'device.invoke']
export const deviceScope = (owner: string | undefined, appId: string) => `${owner || 'guest'}:${appId}`
export function declaredDeviceCapabilities(context: ApplicationContext, bundled: readonly DeviceCapability[] = []) {
  return deviceCapabilities.filter((capability) => bundled.includes(capability) || context.permissions.includes(`device.${capability}`))
}
interface DeviceAdapter {
  platform: typeof devicePlatform
  supported: typeof supportedDeviceCapabilities
  grants: typeof deviceGrants
  changeGrant: typeof changeDeviceGrant
  invoke: typeof invokeDevice
  unavailable?: (capabilities: DeviceCapability[]) => void
}
export const deviceAdapter: DeviceAdapter = { platform: devicePlatform, supported: supportedDeviceCapabilities, grants: deviceGrants, changeGrant: changeDeviceGrant, invoke: invokeDevice, unavailable: (capabilities) => {
  promptNativeDownload(deviceCapabilityLabels[capabilities[0]!], 'ios')
} }
export async function deviceEnvironment(scope: string, declared: readonly DeviceCapability[], adapter = deviceAdapter): Promise<DeviceEnvironment> {
  const [supported, grants] = await Promise.all([adapter.supported(), adapter.grants(scope)])
  return { protocol: DEVICE_PROTOCOL_VERSION, platform: adapter.platform(), capabilities: deviceCapabilities.map((capability) => ({ capability, supported: supported.includes(capability), declared: declared.includes(capability), authorized: grants.includes(capability) })) }
}
/** Caller binding comes from the established transport, never request arguments. */
export async function handleDeviceCall(input: {
  method: HostMethod
  args: unknown
  context: ApplicationContext
  owner?: string
  name: string
  bundled?: readonly DeviceCapability[]
  requestId: string
  signal: AbortSignal
  assertCurrent(): void
  adapter?: typeof deviceAdapter
}) {
  const adapter = input.adapter ?? deviceAdapter
  const scope = deviceScope(input.owner, input.context.appId)
  const declared = declaredDeviceCapabilities(input.context, input.bundled)
  const args = deviceObject(input.args)
  input.assertCurrent()
  if (input.signal.aborted) {
    throw SdkErrorCode.APP_CLOSED()
  }
  if (input.method === 'device.capabilities') {
    if (Object.keys(args).length) {
      throw SdkErrorCode.INVALID_ARGUMENTS()
    }
    return deviceEnvironment(scope, declared, adapter)
  }
  const assertDeclared = async (capabilities: DeviceCapability[]) => {
    if (capabilities.some((capability) => !declared.includes(capability))) {
      throw SdkErrorCode.CAPABILITY_UNAVAILABLE('应用没有声明此设备能力', 403)
    }
    const supported = await adapter.supported()
    if (capabilities.some((capability) => !supported.includes(capability))) {
      adapter.unavailable?.(capabilities.filter((capability) => !supported.includes(capability)))
      throw SdkErrorCode.DEVICE_UNSUPPORTED(adapter.platform() === 'web' ? '此功能需下载 App 后使用' : undefined)
    }
  }
  if (['device.permissions.request', 'device.permissions.revoke'].includes(input.method)) {
    if (Object.keys(args).some((key) => key !== 'capabilities')) {
      throw SdkErrorCode.INVALID_ARGUMENTS()
    }
    const capabilities = parseDeviceCapabilities(args.capabilities)
    await assertDeclared(capabilities)
    input.assertCurrent()
    if (input.method === 'device.permissions.revoke') {
      await adapter.changeGrant(scope, capabilities, false)
    } else {
      const missing = capabilities.filter((capability) => !declared.includes(capability))
      if (missing.length) {
        throw SdkErrorCode.CAPABILITY_UNAVAILABLE()
      }
      const granted = await adapter.grants(scope)
      const needed = capabilities.filter((capability) => !granted.includes(capability))
      if (needed.length && await requestDeviceConsent(input.name, needed, input.signal)) {
        input.assertCurrent()
        if (input.signal.aborted) {
          throw SdkErrorCode.APP_CLOSED()
        }
        await adapter.changeGrant(scope, needed, true)
      }
    }
    return deviceEnvironment(scope, declared, adapter)
  }
  if (Object.keys(args).some((key) => !['capability', 'arguments'].includes(key))) {
    throw SdkErrorCode.INVALID_ARGUMENTS()
  }
  const capability = parseDeviceCapability(args.capability)
  const value = parseDeviceInput(capability, args.arguments)
  await assertDeclared([capability])
  if (!(await adapter.grants(scope)).includes(capability)) {
    if (!await requestDeviceConsent(input.name, [capability], input.signal)) {
      throw SdkErrorCode.DEVICE_PERMISSION_DENIED()
    }
    input.assertCurrent()
    if (input.signal.aborted) {
      throw SdkErrorCode.APP_CLOSED()
    }
    await adapter.changeGrant(scope, [capability], true)
  } else if (capability === 'calendar.remove' && !await requestDeviceConsent(input.name, [capability], input.signal)) {
    throw SdkErrorCode.REQUEST_CANCELLED()
  }
  input.assertCurrent()
  if (input.signal.aborted) {
    throw SdkErrorCode.APP_CLOSED()
  }
  return adapter.invoke(scope, capability, value, input.requestId)
}
