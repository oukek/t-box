import type { OpenAppArguments } from '@t-box/shared'
import { nextTick, reactive, readonly } from 'vue'
import { applicationModules } from '../applications/registry'
import { ErrorCode } from '../error-codes.js'
import { canFloatAssistant } from '../features/assistant/geometry'
import { clearCheckoutTicket } from '../features/billing/checkoutLink'
import { showWechatLogin } from '../features/identity/wechatLogin'
import { parseOpenAppArguments } from './applications'
import { promptNativeDownload } from './native-runtime/downloads'
import { identity } from './session'

export const primaryTabs = [
  { id: 'home', label: 'AI', icon: 'sparkle', hash: '#/ai' },
  { id: 'applications', label: '桌面', icon: 'apps', hash: '#/' },
] as const
type Tab = (typeof primaryTabs)[number]['id']
type Screen =
  | Exclude<Tab, 'home'> |
  'application' |
  'capabilities' |
  'resources' |
  'account' |
  'wallet' |
  'recharge' |
  'pricing' | 'memory' | 'devicePermissions' | 'shortcuts' | 'paymentHandoff'
type BackTarget = Tab | 'profile' | 'wallet'
export const tabLabel = (id: BackTarget) =>
  id === 'profile'
    ? '设置'
    : id === 'wallet'
      ? '余额'
      : primaryTabs.find((tab) => tab.id === id)!.label
const state = reactive<{
  screen: Screen
  application: OpenAppArguments | null
  capabilityAppId: string | null
  revision: number
  backTo: BackTarget
  assistantOpen: boolean
}>({
  screen: 'applications',
  application: null,
  capabilityAppId: null,
  revision: 0,
  backTo: 'applications',
  assistantOpen: false,
})
export const navigation = readonly(state)
let started = false
let workspaceHash = ''
let assistantWorkspaceHash = '#/'

function assistantHash(hash: string, open: boolean) {
  const [path, query] = (hash || '#/').split('?')
  const params = new URLSearchParams(query)
  params.delete('__assistant')
  if (open) {
    params.set('__assistant', '1')
  }
  return `${path}${params.size ? `?${params}` : ''}`
}
function pushWorkspace(hash: string, assistant = false) {
  workspaceHash = assistantHash(hash, false)
  state.assistantOpen = assistant
  const nextHash = assistantHash(hash, assistant)
  if (location.hash !== nextHash) {
    history.pushState(null, '', nextHash)
  }
  if (assistant) {
    assistantWorkspaceHash = workspaceHash
  }
}
export function openAssistant() {
  if (state.assistantOpen) {
    return
  }
  assistantWorkspaceHash = assistantHash(location.hash || '#/', false)
  state.assistantOpen = true
  history.pushState({ tboxAssistantEntry: true }, '', assistantHash(assistantWorkspaceHash, true))
}
export function closeAssistant() {
  if (!state.assistantOpen) {
    return
  }
  state.assistantOpen = false
  if (history.state?.tboxAssistantEntry) {
    history.back()
  } else {
    history.replaceState(null, '', assistantHash(location.hash.split('?')[0] === '#/ai' ? '#/' : location.hash, false))
  }
}

function readHash() {
  const [path, rawQuery] = window.location.hash.replace(/^#/, '').split('?')
  const params = new URLSearchParams(rawQuery)
  state.assistantOpen = params.get('__assistant') === '1' || path === '/ai'
  params.delete('__assistant')
  const query = params.toString()
  const background = path === '/ai' || path === '/applications' || !path ? '#/' : `#${path}${query ? `?${query}` : ''}`
  if (state.assistantOpen) {
    assistantWorkspaceHash = background
  }
  // Opening/closing the assistant must not remount the application underneath.
  if (background === workspaceHash) {
    return
  }
  workspaceHash = background
  state.application = null
  if (path !== '/pay/wechat') {
    clearCheckoutTicket()
  }
  const tab = primaryTabs.find((tab) => tab.hash === `#${path || '/'}`)
  for (const module of applicationModules) {
    const params = module.resolveLink?.(path || '', new URLSearchParams(query))
    if (params) {
      state.application = {
        appId: module.manifest.id,
        params: module.parseParams(params),
      }
      state.screen = 'application'
      state.backTo = 'applications'
      state.revision++
      return
    }
  }
  if (tab || path === '/applications') {
    state.screen = 'applications'
    state.backTo = 'applications'
    return
  }
  if (path === '/profile') {
    state.application = { appId: 'profile', params: {} }
    state.screen = 'application'
    state.backTo = 'applications'
    state.revision++
    return
  }
  // Legacy account URLs (including payment callbacks) remain valid after moving AI pages.
  const detail = /^\/(?:ai|profile)\/(wallet|recharge|pricing|resources|memory)$/.exec(
    path || '',
  )
  if (detail) {
    const params = new URLSearchParams(query)
    state.screen =
      detail[1] === 'wallet' && params.has('paymentOrder')
        ? 'recharge'
        : (detail[1] as 'wallet' | 'recharge' | 'pricing' | 'resources' | 'memory')
    state.backTo =
      state.screen === 'recharge' ||
      (state.screen === 'pricing' && params.get('from') === 'wallet')
        ? 'wallet'
        : 'home'
    return
  }
  if (path === '/profile/device-permissions' || path === '/profile/shortcuts') {
    if (path.endsWith('shortcuts') && promptNativeDownload('快捷指令', 'ios')) {
      state.application = { appId: 'profile', params: {} }
      state.screen = 'application'
      state.backTo = 'applications'
      state.revision++
      history.replaceState(null, '', '#/applications/profile')
      return
    }
    if (path.endsWith('device-permissions')) {
      promptNativeDownload('本机设备权限', 'ios')
    }
    state.screen = path.endsWith('shortcuts') ? 'shortcuts' : 'devicePermissions'
    state.backTo = 'profile'
    return
  }
  if (path === '/profile/settings') {
    state.screen = 'account'
    state.backTo = 'profile'
    return
  }
  if (path === '/pay/wechat') {
    state.screen = 'paymentHandoff'
    state.revision++
    state.backTo = 'home'
    return
  }
  if (path?.startsWith('/applications/')) {
    const match = /^\/applications\/([^/]+)\/capabilities$/.exec(path)
    if (
      match &&
      applicationModules.some(
        (module) => module.manifest.id === match[1] && module.ai,
      )
    ) {
      state.capabilityAppId = match[1]!
      state.screen = 'capabilities'
      state.backTo = 'applications'
      return
    }
    try {
      const params = new URLSearchParams(query)
      const args = parseOpenAppArguments({
        appId: path.slice('/applications/'.length),
        params: Object.fromEntries(params),
      })
      state.application = args
      state.screen = 'application'
      state.backTo = 'applications'
      state.revision++
      return
    } catch {
      /* Invalid application hashes fall back to the home screen. */
    }
  }
  state.screen = 'applications'
}

export function startNavigation() {
  if (started) {
    return
  }
  started = true
  readHash()
  window.addEventListener('hashchange', readHash)
}

export function navigateTab(screen: Tab) {
  if (screen === 'home') {
    if (!['applications', 'application'].includes(state.screen)) {
      history.pushState(null, '', assistantHash(assistantWorkspaceHash, true))
      readHash()
    } else {
      openAssistant()
    }
    return
  }
  state.screen = 'applications'
  state.application = null
  state.backTo = 'applications'
  pushWorkspace('#/')
  window.scrollTo({ top: 0 })
}

export async function openApplication(value: unknown) {
  const args = parseOpenAppArguments(value)
  // Local tools use the profile entry to request a cloud account; keep their place underneath.
  if (args.appId === 'profile' && !identity.user) {
    await showWechatLogin()
    return args
  }
  const keepAssistant = state.assistantOpen && canFloatAssistant({ width: window.innerWidth, height: window.innerHeight })
  state.backTo = 'applications'
  state.application = args
  state.screen = 'application'
  state.revision++
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(args.params || {})) {
    params.set(key, value)
  }
  const query = params.size ? `?${params}` : ''
  pushWorkspace(`#/applications/${args.appId}${query}`, keepAssistant)
  window.scrollTo({ top: 0 })
  // Enter the launch view before a cold module download, while callers still await preparation.
  await applicationModules
    .find((module) => module.manifest.id === args.appId)
    ?.prepare?.()
  await nextTick()
  // The root has rendered the registered feature before reporting tool success.
  await nextTick()
  return args
}

export function openApplicationCapabilities(appId: string) {
  if (
    !applicationModules.some(
      (module) => module.manifest.id === appId && module.ai,
    )
  ) {
    throw ErrorCode.INTERNAL_AI()
  }
  state.capabilityAppId = appId
  state.screen = 'capabilities'
  state.backTo = 'applications'
  pushWorkspace(`#/applications/${appId}/capabilities`)
  window.scrollTo({ top: 0 })
}

export function backFromApplication() {
  if (state.backTo === 'profile') {
    void openProfile()
  } else if (state.backTo === 'wallet') {
    openWallet()
  } else {
    navigateTab(state.backTo)
  }
}
export function isApplicationActive(appId: string) {
  return state.application?.appId === appId && state.screen === 'application'
}
export function openProfile() {
  return openApplication({ appId: 'profile' })
}
export function openResources() {
  state.screen = 'resources'
  state.backTo = 'home'
  pushWorkspace('#/ai/resources')
  window.scrollTo({ top: 0 })
}

export function openMemory() {
  state.screen = 'memory'
  state.backTo = 'home'
  pushWorkspace('#/ai/memory')
  window.scrollTo({ top: 0 })
}

export function openAccountSettings() {
  state.screen = 'account'
  state.backTo = 'profile'
  pushWorkspace('#/profile/settings')
  window.scrollTo({ top: 0 })
}

export function openWallet() {
  state.screen = 'wallet'
  state.backTo = 'home'
  pushWorkspace('#/ai/wallet')
  window.scrollTo({ top: 0 })
}

export function openRecharge(orderId?: string) {
  state.screen = 'recharge'
  state.backTo = 'wallet'
  pushWorkspace(`#/ai/recharge${orderId ? `?paymentOrder=${encodeURIComponent(orderId)}` : ''}`)
  window.scrollTo({ top: 0 })
}
export function openPricing() {
  const fromWallet = state.screen === 'wallet'
  state.screen = 'pricing'
  state.backTo = fromWallet ? 'wallet' : 'home'
  pushWorkspace(`#/ai/pricing${fromWallet ? '?from=wallet' : ''}`)
  window.scrollTo({ top: 0 })
}

export function openDevicePermissions() {
  promptNativeDownload('本机设备权限', 'ios')
  state.backTo = state.screen === 'applications' ? 'applications' : 'profile'
  state.screen = 'devicePermissions'
  pushWorkspace('#/profile/device-permissions')
}
export function openShortcuts() {
  if (promptNativeDownload('快捷指令', 'ios')) {
    return
  }
  state.screen = 'shortcuts'
  state.backTo = 'profile'
  pushWorkspace('#/profile/shortcuts')
}
