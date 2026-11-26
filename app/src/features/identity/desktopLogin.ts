import type { AppUser, UserSession } from '@t-box/shared'
import { request } from '../../core/network'

const BRIDGE = 'http://127.0.0.1:17436/v1'
export interface DesktopAccount { user: Pick<AppUser, 'id' | 'nickname' | 'avatarUrl'>, challenge: string }
export interface DesktopProof { id: string, secret: string, target: 'browser' | 'collector' }
async function local<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    const options: RequestInit & { targetAddressSpace: 'loopback' } = {
      targetAddressSpace: 'loopback',
      method: body ? 'POST' : 'GET',
      headers: { 'X-Tbox-Login': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    }
    response = await fetch(`${BRIDGE}/${path}`, options)
  } catch {
    throw new Error('未连接到 Mac 版。请打开并登录新版 Mac 应用，并允许浏览器访问本机应用后重试。')
  }
  const result = await response.json().catch(() => {
    throw new Error('本机登录服务响应异常，请更新并重启 Mac 版后重试')
  })
  if (!response.ok) {
    throw new Error(result.error || 'Mac 版快捷登录暂不可用')
  }
  return result as T
}
export async function desktopPermission(): Promise<PermissionState | 'unknown'> {
  try {
    return (await navigator.permissions.query({ name: 'loopback-network' as PermissionName })).state
  } catch {
    return 'unknown'
  }
}
export async function detectDesktopAccount(): Promise<DesktopAccount> {
  const result = await local<DesktopAccount>('account')
  if (!result?.user?.id || typeof result.user.nickname !== 'string' || typeof result.challenge !== 'string' || !/^[a-f0-9-]{36}$/.test(result.challenge)) {
    throw new Error('Mac 版登录服务版本不兼容，请更新后重试')
  }
  return result
}
export async function approveDesktopAccount(account: DesktopAccount, proof: DesktopProof, signal?: AbortSignal) {
  await local('approve', { ...proof, userId: account.user.id, challenge: account.challenge }, signal)
}
export async function loginFromDesktop(account: DesktopAccount, signal?: AbortSignal): Promise<UserSession> {
  const secret = [...crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, '0')).join('')
  const { data } = await request<{ data: { id: string } }>('/auth/handoff/start', { method: 'POST', body: JSON.stringify({ secret, target: 'browser' }), signal })
  const proof: DesktopProof = { id: data.id, secret, target: 'browser' }
  await approveDesktopAccount(account, proof, signal)
  return (await request<{ data: UserSession }>('/auth/handoff/redeem', { method: 'POST', body: JSON.stringify({ ...proof, userId: account.user.id }), signal })).data
}
