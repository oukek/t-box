import type { WechatLoginFlow, WechatLoginResult } from '@t-box/shared'
import QRCode from 'qrcode'
import { reactive, readonly } from 'vue'
import { request } from '../../core/network'
import { watchQrState } from '../../core/qrSocket'
import { identity, setSession } from '../../core/session'
import { captureCheckoutLink, checkoutTicket, markCheckoutAuthenticated } from '../billing/checkoutLink'
import { isWechatPayBrowser } from '../billing/paymentEnvironment'
import { restoreSession } from './identityApi'

const storageKey = 'tbox.wechat.authorization.v1'
const logoutKey = 'tbox.wechat.logged-out'
const state = reactive({
  initializing: true,
  active: false,
  phase: 'idle' as 'idle' | 'loading' | 'redirecting' | 'qr' | 'confirm' | 'done' | 'error' | 'outside',
  busy: false,
  error: '',
  qr: '',
  qrUrl: '',
  expiresAt: '',
  copied: false,
  result: null as WechatLoginResult | null,
})
export const wechatLogin = readonly(state)
export const inWechat = /MicroMessenger/i.test(navigator.userAgent)
interface LocalFlow extends WechatLoginFlow {
  secret: string
  returnHash: string
  parentId?: string
  checkoutTicket?: string
}
let current: LocalFlow | null = null
let scanId: string | undefined
let stopUpdates: (() => void) | undefined
let generation = 0
let initialized: Promise<void> | undefined
let authorizationReturnHash: string | undefined
let authorizationCheckoutTicket: string | undefined

function forget() {
  try {
    sessionStorage.removeItem(storageKey)
  } catch { /* A failed storage write is handled before redirecting. */ }
}
function readFlow(): LocalFlow | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null') as LocalFlow | null
    return value && /^[a-f0-9-]{36}$/.test(value.id) && /^[a-f0-9]{64}$/.test(value.secret) && Date.parse(value.expiresAt) > Date.now() ? value : null
  } catch {
    return null
  }
}
function suppressed() {
  try {
    return sessionStorage.getItem(logoutKey) === '1'
  } catch {
    return false
  }
}
export function suppressAutomaticWechatLogin() {
  authorizationReturnHash = undefined
  authorizationCheckoutTicket = undefined
  stopWechatUpdates()
  state.phase = 'idle'
  state.active = false
  state.error = ''
  state.result = null
  current = null
  forget()
  try {
    sessionStorage.setItem(logoutKey, '1')
  } catch { /* The manual login button is still available. */ }
}
function error(cause: unknown) {
  state.busy = false
  state.phase = 'error'
  state.error = cause instanceof Error ? cause.message : '微信登录未完成，请重试。'
}
async function call<T>(path: string, body: unknown) {
  return (await request<{ data: T }>(`/auth/wechat/${path}`, { method: 'POST', body: JSON.stringify(body), timeoutMs: path === 'exchange' ? 25_000 : 15_000 })).data
}
function proof() {
  if (!current) {
    throw new Error('本次授权已失效，请重新登录。')
  }
  return { id: current.id, secret: current.secret }
}
function accept(result: WechatLoginResult) {
  state.result = result
  state.busy = false
  if (result.session && result.kind !== 'scan') {
    stopWechatUpdates()
    const returnHash = current?.returnHash
    if (current?.checkoutTicket) {
      markCheckoutAuthenticated(current.checkoutTicket)
    }
    setSession(result.session)
    forget()
    try {
      sessionStorage.removeItem(logoutKey)
    } catch { /* The new verified session remains valid. */ }
    state.active = false
    state.phase = 'done'
    if (returnHash?.startsWith('#/')) {
      location.hash = returnHash
    }
  } else if (result.kind === 'scan' && result.status === 'scanned') {
    state.phase = 'confirm'
  } else if (result.kind === 'scan' && result.status === 'complete') {
    stopWechatUpdates()
    state.phase = 'done'
    forget()
  } else if (['cancelled', 'failed', 'expired'].includes(result.status)) {
    throw new Error(result.status === 'cancelled' ? '已取消登录。请在原设备刷新二维码后重试。' : '本次登录已失效，请重新授权或刷新二维码。')
  }
}
function watchLogin(active: number) {
  if (active !== generation || !current) {
    return
  }
  stopUpdates?.()
  stopUpdates = watchQrState({ type: 'login', ...proof() }, (event) => {
    if (active === generation && event.type === 'login.state') {
      try {
        state.error = ''
        accept(event.data)
      } catch (cause) {
        error(cause)
      }
    }
  }, (message) => {
    if (active === generation) {
      state.error = message
      state.busy = false
      if (/失效|过期|取消|停用/.test(message)) {
        state.phase = 'error'
      }
    }
  })
}
export function stopWechatUpdates() {
  generation++
  stopUpdates?.()
  stopUpdates = undefined
}

async function begin(kind: WechatLoginFlow['kind']) {
  stopWechatUpdates()
  const active = generation
  state.busy = true
  state.error = ''
  state.phase = 'loading'
  state.result = null
  state.copied = false
  if (current?.kind === 'qr') {
    void call('cancel', proof()).catch(() => {})
  }
  current = null
  try {
    const secret = [...crypto.getRandomValues(new Uint8Array(32))].map((value) => value.toString(16).padStart(2, '0')).join('')
    const checkout = authorizationCheckoutTicket
    const flow = await call<WechatLoginFlow>('start', { kind, secret, ...(kind === 'scan' ? { parentId: scanId } : {}), ...(checkout ? { checkoutTicket: checkout } : {}) })
    if (active !== generation) {
      return
    }
    current = { ...flow, secret, returnHash: authorizationReturnHash || location.hash || '#/', ...(kind === 'scan' ? { parentId: scanId } : {}), ...(checkout ? { checkoutTicket: checkout } : {}) }
    authorizationReturnHash = undefined
    authorizationCheckoutTicket = undefined
    state.expiresAt = flow.expiresAt
    if (flow.authorizationUrl) {
      sessionStorage.setItem(storageKey, JSON.stringify(current))
      state.phase = 'redirecting'
      location.assign(flow.authorizationUrl)
    } else if (flow.qrUrl) {
      state.qrUrl = flow.qrUrl
      state.qr = await QRCode.toDataURL(flow.qrUrl, { width: 256, margin: 2, errorCorrectionLevel: 'M' })
      if (active !== generation) {
        return
      }
      state.phase = 'qr'
      state.busy = false
      watchLogin(active)
    }
  } catch (cause) {
    if (active === generation) {
      error(cause)
    }
  }
}

export async function startWechatLogin() {
  if (state.busy) {
    return
  }
  if (scanId) {
    if (!inWechat) {
      state.qrUrl = `${location.origin}/?wechatScan=${scanId}`
      state.phase = 'outside'
      return
    }
    await begin('scan')
  } else {
    await begin(inWechat ? 'login' : 'qr')
  }
}
export async function startWechatCheckoutLogin(ticket: string) {
  if (!/^[a-f0-9]{64}$/.test(ticket)) {
    return
  }
  authorizationReturnHash = `#/pay/wechat?ticket=${ticket}`
  authorizationCheckoutTicket = ticket
  state.active = true
  await startWechatLogin()
}
export async function retryWechatLogin() {
  if (current && current.kind !== 'qr') {
    state.busy = true
    try {
      const result = await call<WechatLoginResult>('poll', proof())
      if (['complete', 'scanned'].includes(result.status)) {
        state.error = ''
        accept(result)
        return
      }
    } catch { /* A consumed/expired OAuth code requires a new authorization. */ }
    state.busy = false
  }
  if (current?.checkoutTicket) {
    authorizationReturnHash = current.returnHash
    authorizationCheckoutTicket = current.checkoutTicket
  }
  await startWechatLogin()
}
export async function confirmWechatLogin(approve: boolean) {
  if (state.busy) {
    return
  }
  state.busy = true
  try {
    accept(await call<WechatLoginResult>('confirm', { ...proof(), approve }))
  } catch (cause) {
    error(cause)
  }
}
export async function copyWechatLink() {
  try {
    await navigator.clipboard.writeText(scanId ? `${location.origin}/?wechatScan=${scanId}` : state.qrUrl)
    state.copied = true
  } catch {
    state.error = '无法自动复制，请长按下方链接手动复制。'
  }
}
export function closeWechatLogin() {
  authorizationReturnHash = undefined
  authorizationCheckoutTicket = undefined
  stopWechatUpdates()
  state.active = false
  state.phase = 'idle'
  scanId = undefined
  forget()
}
export async function showWechatLogin() {
  if (!inWechat && state.phase === 'idle') {
    await startWechatLogin()
  } else if (!inWechat && state.phase === 'qr' && current?.kind === 'qr') {
    stopWechatUpdates()
    watchLogin(generation)
  }
}

export function initializeWechatLogin() {
  initialized ??= (async () => {
    const url = new URL(location.href)
    const code = url.searchParams.get('code')
    const oauthState = url.searchParams.get('state')
    const scan = url.searchParams.get('wechatScan')
    scanId = scan && /^[a-f0-9-]{36}$/.test(scan) ? scan : undefined
    if (code || oauthState || scan) {
      for (const key of ['code', 'state', 'wechatScan']) {
        url.searchParams.delete(key)
      }
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
    const checkoutReturnHash = captureCheckoutLink()
    await restoreSession()
    try {
      current = readFlow()
      if (code || oauthState) {
        state.active = true
        if (!current || current.state !== oauthState || !code) {
          throw new Error('微信授权状态已失效，请重新发起登录。')
        }
        scanId = current.parentId
        state.phase = 'loading'
        state.busy = true
        accept(await call<WechatLoginResult>('exchange', { ...proof(), state: oauthState, code }))
      } else if (scanId) {
        state.active = true
        await startWechatLogin()
      } else if (current?.kind === 'scan') {
        state.active = true
        scanId = current.parentId
        accept(await call<WechatLoginResult>('poll', proof()))
        if (state.phase === 'idle') {
          throw new Error('授权尚未完成，请重新授权。')
        }
      } else if (inWechat && checkoutReturnHash && isWechatPayBrowser(navigator.userAgent, matchMedia('(pointer:coarse)').matches, navigator.maxTouchPoints)) {
        state.active = true
        authorizationReturnHash = checkoutReturnHash
        authorizationCheckoutTicket = checkoutTicket(checkoutReturnHash) ?? undefined
        await startWechatLogin()
      } else if (inWechat && !identity.user && !suppressed() && !checkoutReturnHash) {
        state.active = true
        await startWechatLogin()
      }
    } catch (cause) {
      state.active = true
      error(cause)
    } finally {
      state.initializing = false
    }
  })()
  return initialized
}
