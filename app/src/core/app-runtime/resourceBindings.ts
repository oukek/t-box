import type { ResourceRef } from '@t-box/app-contracts'
import { AppSdkError } from '@t-box/app-sdk'
import { shallowReactive } from 'vue'

const resources = shallowReactive(new Map<string, ResourceRef[]>())
export const getApplicationBindings = (appId: string) => resources.get(appId) || []
export function setApplicationBindings(appId: string, input: unknown) {
  if (!Array.isArray(input) || input.length > 8 || input.some((ref) =>
    !ref || ref.appId !== appId || Object.keys(ref).some((k) => !['appId', 'resourceType', 'resourceId'].includes(k)) ||
    typeof ref.resourceType !== 'string' || !/^[\w-]{1,40}$/.test(ref.resourceType) ||
    typeof ref.resourceId !== 'string' || !/^[\w-]{1,100}$/.test(ref.resourceId))) {
    throw new AppSdkError('INVALID_RESOURCE_BINDING', '应用资源绑定无效')
  }
  resources.set(appId, input.map((ref) => ({ ...ref })))
}
export function clearApplicationBindings(appId?: string) {
  if (appId) {
    resources.delete(appId)
  } else {
    resources.clear()
  }
}
