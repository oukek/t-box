import type { OpenAppArguments } from '@t-box/shared'
import { nextTick, reactive, readonly, watch } from 'vue'
import { applicationModules } from '../applications/registry'
import { ErrorCode } from '../error-codes.js'
import { clearCheckoutTicket } from '../features/billing/checkoutLink'
import { showWechatLogin } from '../features/identity/wechatLogin'
import { parseOpenAppArguments } from './applications'
import { promptNativeDownload } from './native-runtime/downloads'
import { identity } from './session'

export const primaryTabs = [
  { id: 'home', label: 'AI', icon: 'sparkle', hash: '#/' },
  { id: 'applications', label: 'OS', icon: 'apps', hash: '#/applications' },
] as const
type Tab = (typeof primaryTabs)[number]['id']
type Screen =
  | Tab |
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
  applicationPresentation: 'page' | 'window'
}>({
  screen: 'home',
  application: null,
  capabilityAppId: null,
  revision: 0,
  backTo: 'home',
  applicationPresentation: 'page',
})
export const navigation = readonly(state)
let started = false
let returnFocus: HTMLElement | null = null

function readHash() {
  closeApplicationWindow()
  const [path, query] = window.location.hash.replace(/^#/, '').split('?')
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
  if (tab) {
    state.screen = tab.id
    state.backTo = tab.id
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
  state.screen = 'home'
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
  if (screen !== 'home') {
    closeApplicationWindow()
  }
  state.screen = screen
  state.backTo = screen
  const hash = primaryTabs.find((tab) => tab.id === screen)!.hash
  if (location.hash !== hash) {
    history.pushState(null, '', hash)
  }
  window.scrollTo({ top: 0 })
}

export async function openApplication(value: unknown) {
  const args = parseOpenAppArguments(value)
  // Local tools use the profile entry to request a cloud account; keep their place underneath.
  if (args.appId === 'profile' && !identity.user) {
    await showWechatLogin()
    return args
  }
  if (state.screen === 'home') {
    // Presentation belongs to the host. App parameters and SDK contracts remain unchanged.
    if (state.applicationPresentation !== 'window') {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    state.application = args
    state.applicationPresentation = 'window'
    state.revision++
    await applicationModules.find((module) => module.manifest.id === args.appId)?.prepare?.()
    await nextTick()
    await nextTick()
    return args
  }
  state.applicationPresentation = 'page'
  if (state.screen !== 'application') {
    state.backTo =
      state.screen === 'capabilities'
        ? 'applications'
        : ['account', 'devicePermissions', 'shortcuts'].includes(state.screen)
            ? state.backTo
            : ['resources', 'wallet', 'recharge', 'pricing', 'memory'].includes(
                state.screen,
              )
                ? 'home'
                : (state.screen as Tab)
  }
  if (args.appId === 'profile') {
    state.backTo = 'applications'
  }
  state.application = args
  state.screen = 'application'
  state.revision++
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(args.params || {})) {
    params.set(key, value)
  }
  const query = params.size ? `?${params}` : ''
  history.pushState(null, '', `#/applications/${args.appId}${query}`)
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
  history.pushState(null, '', `#/applications/${appId}/capabilities`)
  window.scrollTo({ top: 0 })
}

export function backFromApplication() {
  if (state.screen === 'home' && state.applicationPresentation === 'window') {
    closeApplicationWindow()
    return
  }
  if (state.backTo === 'profile') {
    void openProfile()
  } else if (state.backTo === 'wallet') {
    openWallet()
  } else {
    navigateTab(state.backTo)
  }
}
export function closeApplicationWindow() {
  if (state.applicationPresentation !== 'window') {
    return
  }
  state.applicationPresentation = 'page'
  state.application = null
  const target = returnFocus
  returnFocus = null
  void nextTick(() => {
    if (state.screen === 'home' && target?.isConnected) {
      target.focus({ preventScroll: true })
    }
  })
}
export function isApplicationActive(appId: string) {
  return state.application?.appId === appId && (state.screen === 'application' || (state.screen === 'home' && state.applicationPresentation === 'window'))
}
watch(() => state.screen, (screen) => {
  if (screen !== 'home') {
    closeApplicationWindow()
  }
}, { flush: 'sync' })
export function openProfile() {
  return openApplication({ appId: 'profile' })
}
export function openResources() {
  state.screen = 'resources'
  state.backTo = 'home'
  history.pushState(null, '', '#/ai/resources')
  window.scrollTo({ top: 0 })
}

export function openMemory() {
  state.screen = 'memory'
  state.backTo = 'home'
  history.pushState(null, '', '#/ai/memory')
  window.scrollTo({ top: 0 })
}

export function openAccountSettings() {
  state.screen = 'account'
  state.backTo = 'profile'
  history.pushState(null, '', '#/profile/settings')
  window.scrollTo({ top: 0 })
}

export function openWallet() {
  state.screen = 'wallet'
  state.backTo = 'home'
  history.pushState(null, '', '#/ai/wallet')
  window.scrollTo({ top: 0 })
}

export function openRecharge(orderId?: string) {
  state.screen = 'recharge'
  state.backTo = 'wallet'
  history.pushState(
    null,
    '',
    `#/ai/recharge${orderId ? `?paymentOrder=${encodeURIComponent(orderId)}` : ''}`,
  )
  window.scrollTo({ top: 0 })
}
export function openPricing() {
  const fromWallet = state.screen === 'wallet'
  state.screen = 'pricing'
  state.backTo = fromWallet ? 'wallet' : 'home'
  history.pushState(null, '', `#/ai/pricing${fromWallet ? '?from=wallet' : ''}`)
  window.scrollTo({ top: 0 })
}

export function openDevicePermissions() {
  promptNativeDownload('本机设备权限', 'ios')
  state.backTo = state.screen === 'applications' ? 'applications' : 'profile'
  state.screen = 'devicePermissions'
  history.pushState(null, '', '#/profile/device-permissions')
}
export function openShortcuts() {
  if (promptNativeDownload('快捷指令', 'ios')) {
    return
  }
  state.screen = 'shortcuts'
  state.backTo = 'profile'
  history.pushState(null, '', '#/profile/shortcuts')
}
