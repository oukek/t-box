import type { ApplicationContext, InstalledApplicationAction, ShortcutTemplateInput } from '@t-box/app-contracts'
import { SdkErrorCode } from '@t-box/app-sdk'
import { request } from '../network'
import { identity } from '../session'
import { selectShortcutAction } from './action-selection'
import { nativeDevice } from './adapter'
import { requestActionConsent } from './consent'

export async function applicationActions(appId: string): Promise<InstalledApplicationAction[]> {
  if (!identity.user) {
    throw SdkErrorCode.AUTH_REQUIRED()
  }
  const { data } = await request<{ data: InstalledApplicationAction[] }>('/native/actions')
  return data.filter((action) => action.appId === appId)
}
export async function saveApplicationShortcut(context: ApplicationContext, value: unknown, signal: AbortSignal, assertCurrent: () => void) {
  const input = value as ShortcutTemplateInput | null
  if (!input || Object.keys(input).some((key) => !['title', 'actionId', 'actionVersion', 'arguments', 'runtimeBindings'].includes(key)) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100 || typeof input.actionId !== 'string' || !Number.isSafeInteger(input.actionVersion) || input.actionVersion < 1 || !input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments) || new TextEncoder().encode(JSON.stringify(input.arguments)).byteLength > 60000) {
    throw SdkErrorCode.INVALID_ARGUMENTS('快捷动作参数无效')
  }
  const bindings = input.runtimeBindings ?? {}
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings) || Object.keys(bindings).length > 20 || Object.entries(bindings).some(([path, kind]) => !/^\/(?:[^~]|~[01]){1,200}$/.test(path) || !['now', 'today'].includes(kind))) {
    throw SdkErrorCode.INVALID_ARGUMENTS('快捷动作的动态参数无效')
  }
  const plugin = await nativeDevice()
  const action = selectShortcutAction(context, input.actionId, input.actionVersion, await applicationActions(context.appId))
  assertCurrent()
  if (!action) {
    throw SdkErrorCode.CAPABILITY_UNAVAILABLE('此应用动作尚未开放给快捷指令')
  }
  const user = identity.user?.id
  if (!user || (await plugin.sessionStatus()).subject !== user) {
    throw SdkErrorCode.AUTH_REQUIRED('原生会话正在准备，请联网后稍后重试')
  }
  if (!await requestActionConsent(input.title, action.title, action.effect === 'write', signal)) {
    throw SdkErrorCode.REQUEST_CANCELLED()
  }
  assertCurrent()
  const id = crypto.randomUUID()
  await plugin.saveTemplate({ template: { id, appId: context.appId, actionId: action.id, actionVersion: action.version, title: input.title.trim(), releaseId: action.releaseId, generation: action.generation, subject: user, argumentsJSON: JSON.stringify(input.arguments), bindingsJSON: JSON.stringify(bindings) } })
  return { id, title: input.title.trim() }
}
