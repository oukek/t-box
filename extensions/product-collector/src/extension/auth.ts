const SITE = 'https://tboxos.cn'
const API = 'https://api.tboxos.cn/api/v1'
const KEY = 'collector.account.v1'
const PENDING = 'collector.authorization.v1'
interface User { id: string, nickname: string, avatarUrl?: string }
interface Account { token: string, user: User }
interface Attempt { id?: string, secret: string, qrUrl?: string, qrError?: string, desktop?: { id: string, secret: string, userId: string }, expiresAt: string, nonce: string, mode: string, tabId?: number, windowId?: number }
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
let queue = Promise.resolve<unknown>(undefined)
function serialize<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job)
  queue = next.catch(() => {})
  return next
}
async function api<T>(path: string, body?: unknown, token?: string, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await fetch(`${API}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), credentials: 'omit' })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw Object.assign(new Error(error?.error?.message || error?.message || '账号服务暂时不可用，请重试'), { status: response.status })
  }
  return response.status === 204 ? undefined as T : (await response.json()).data
}
async function account(): Promise<Account | undefined> {
  await storageReady
  return (await chrome.storage.local.get(KEY))[KEY] as Account | undefined
}
async function pending(): Promise<Attempt | undefined> {
  return (await chrome.storage.session.get(PENDING))[PENDING] as Attempt | undefined
}
async function cancel() {
  const attempt = await pending()
  if (!attempt) {
    return
  }
  await chrome.storage.session.remove(PENDING)
  if (attempt.id) {
    await api('/auth/wechat/cancel', { id: attempt.id, secret: attempt.secret }).catch(() => {})
  }
  if (attempt.windowId !== undefined) {
    await chrome.windows.remove(attempt.windowId).catch(() => {})
  }
}
export async function authAction(action: string, message: Record<string, unknown>) {
  return serialize(async () => {
    if (action === 'account') {
      const saved = await account()
      if (!saved) {
        return null
      }
      try {
        const user = await api<User>('/auth/me', undefined, saved.token)
        return user
      } catch (error) {
        if ([401, 403].includes((error as { status: number }).status)) {
          await chrome.storage.local.remove(KEY)
          return null
        }
        throw error
      }
    }
    if (action === 'account-collect') {
      const saved = await account()
      if (!saved || message.userId !== saved.user.id) {
        throw new Error('账号已变化，请重新确认登录账号')
      }
      const products = message.products as unknown[]
      const confirmed: number[] = []
      for (let i = 0; i < products.length; i++) {
        try {
          await api('/collector/products', { products: [products[i]] }, saved.token)
          confirmed.push(i)
        } catch (e) {
          return { confirmed, error: e instanceof Error ? e.message : '上传失败，请重试未完成商品' }
        }
      }
      return { confirmed, error: '' }
    }
    if (action === 'account-candidate') {
      const tabs = await chrome.tabs.query({ url: `${SITE}/*` })
      const candidates = await Promise.all(tabs.slice(0, 5).map(async (tab) => {
        if (tab.id === undefined) {
          return null
        }
        try {
          const user = await chrome.tabs.sendMessage(tab.id, { action: 'collector-account' })
          if (user?.id && typeof user.nickname === 'string') {
            return { id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl }
          }
        } catch { /* Old or unloaded main-site pages have no bridge. */ }
        return null
      }))
      return candidates.find(Boolean) || null
    }
    if (action === 'account-login') {
      await cancel()
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, '0')).join('')
      let flow: Pick<Attempt, 'id' | 'qrUrl' | 'expiresAt' | 'qrError'>
      try {
        flow = await api('/auth/wechat/collector/start', { secret })
      } catch {
        // Mac handoff works independently of WeChat configuration.
        flow = { expiresAt: new Date(Date.now() + 300_000).toISOString(), qrError: '微信扫码暂不可用，可使用 Mac 版快捷登录。' }
      }
      const attempt: Attempt = { ...flow, secret, nonce: crypto.randomUUID(), mode: message.mode === 'other' ? 'other' : 'quick' }
      await chrome.storage.session.set({ [PENDING]: attempt })
      try {
        const popup = await chrome.windows.create({ url: `${SITE}/#collector-login=${chrome.runtime.id}.${attempt.nonce}`, type: 'popup', width: 460, height: 660 })
        attempt.windowId = popup?.id
        attempt.tabId = popup?.tabs?.[0]?.id
        await chrome.storage.session.set({ [PENDING]: attempt })
      } catch (error) {
        await cancel()
        throw error
      }
      return true
    }
    if (action === 'account-logout') {
      await cancel()
      const saved = await account()
      if (saved) {
        try {
          await api('/auth/session', undefined, saved.token, 'DELETE')
        } catch (error) {
          if (![401, 403].includes((error as { status: number }).status)) {
            throw error
          }
        }
      }
      await chrome.storage.local.remove(KEY)
      return true
    }
    throw new Error('不支持的账号操作')
  })
}
chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  void serialize(async () => {
    const attempt = await pending()
    if (!attempt || Date.parse(attempt.expiresAt) <= Date.now() || sender.tab?.id !== attempt.tabId || sender.frameId !== 0 || !sender.url || new URL(sender.url).origin !== SITE || message?.nonce !== attempt.nonce) {
      throw new Error('授权窗口已失效，请从采集插件重新登录')
    }
    if (message.action === 'collector-connect') {
      const { id, secret, qrUrl, expiresAt, mode, qrError } = attempt
      return { id, secret, qrUrl, expiresAt, mode, qrError }
    }
    if (message.action === 'collector-qr-start') {
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, '0')).join('')
      const flow = await api<{ id: string, qrUrl: string, expiresAt: string }>('/auth/wechat/collector/start', { secret })
      if (attempt.id) {
        await api('/auth/wechat/cancel', { id: attempt.id, secret: attempt.secret }).catch(() => {})
      }
      const next = { ...attempt, ...flow, secret, desktop: undefined, qrError: undefined }
      await chrome.storage.session.set({ [PENDING]: next })
      return { ...flow, secret, mode: 'other' }
    }
    if (message.action === 'collector-desktop-start') {
      if (typeof message.userId !== 'string' || !/^[a-f0-9-]{36}$/.test(message.userId)) {
        throw new Error('Mac 版账号无效')
      }
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, '0')).join('')
      const flow = await api<{ id: string }>('/auth/handoff/start', { secret, target: 'collector' })
      if (attempt.id) {
        await api('/auth/wechat/cancel', { id: attempt.id, secret: attempt.secret }).catch(() => {})
      }
      attempt.desktop = { id: flow.id, secret, userId: message.userId }
      await chrome.storage.session.set({ [PENDING]: attempt })
      return { id: flow.id, secret, target: 'collector' }
    }
    if (message.action === 'collector-complete' || message.action === 'collector-desktop-complete') {
      const desktop = message.action === 'collector-desktop-complete'
      if (desktop !== !!attempt.desktop || (!desktop && !attempt.id)) {
        throw new Error('登录方式已变化，请重新登录')
      }
      const next = desktop
        ? await api<Account>('/auth/handoff/redeem', { ...attempt.desktop, target: 'collector' })
        : await api<Account>('/auth/wechat/collector/redeem', { id: attempt.id, secret: attempt.secret })
      const previous = await account()
      await chrome.storage.local.set({ [KEY]: next })
      await chrome.storage.session.remove(PENDING)
      if (previous && previous.token !== next.token) {
        await api('/auth/session', undefined, previous.token, 'DELETE').catch(() => {})
      }
      return { nickname: next.user.nickname }
    }
    throw new Error('不支持的授权操作')
  }).then((data) => reply({ ok: true, data }), (error) => reply({ ok: false, error: error instanceof Error ? error.message : '授权失败' }))
  return true
})
chrome.windows.onRemoved.addListener((windowId) => {
  void serialize(async () => {
    if ((await pending())?.windowId === windowId) {
      await cancel()
    }
  })
})
