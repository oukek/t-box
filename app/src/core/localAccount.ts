import type { AppUser } from '@t-box/shared'

const profileKey = 'tbox.identity.local-profile.v1'
const catalogPrefix = 'tbox.applications.local-catalog.v1.'
/** UI snapshots only; no tokens, passwords, backend responses or unlock capabilities. */
export function readLocalProfile(): AppUser | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(profileKey) || 'null')
    if (!value || typeof value !== 'object') {
      return null
    }
    const user = value as Record<string, unknown>
    if (['id', 'username', 'nickname', 'createdAt'].every((key) => typeof user[key] === 'string' && (user[key] as string).length <= 200) && user.id && user.username) {
      return { id: String(user.id), username: String(user.username), nickname: String(user.nickname), createdAt: String(user.createdAt), ...(typeof user.avatarUrl === 'string' && user.avatarUrl.length <= 2048 ? { avatarUrl: user.avatarUrl } : {}) }
    }
  } catch { /* Missing or corrupt local state must not prevent online login. */ }
  return null
}
export function saveLocalProfile(user: AppUser) {
  try {
    localStorage.setItem(profileKey, JSON.stringify({ id: user.id, username: user.username, nickname: user.nickname, createdAt: user.createdAt, avatarUrl: user.avatarUrl }))
  } catch { /* Local browsing remains available in memory. */ }
}
export function localCatalogKey(userId: string) {
  return catalogPrefix + encodeURIComponent(userId)
}
export function clearLocalAccount(userId?: string) {
  try {
    const previous = userId || readLocalProfile()?.id
    localStorage.removeItem(profileKey)
    if (previous) {
      localStorage.removeItem(localCatalogKey(previous))
    }
  } catch { /* Signing out must succeed even when storage is unavailable. */ }
}
