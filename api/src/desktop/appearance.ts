import type { DesktopAppearanceSnapshot, DesktopWallpapers, WallpaperSource } from '@t-box/app-contracts'
import type { DataSource } from 'typeorm'
import { builtinWallpapers, defaultDesktopWallpapers } from '@t-box/app-contracts'
import { ApiError } from '@t-box/server-foundation/errors'

const targets = ['common', 'mobile', 'tablet', 'pc'] as const
const invalid = () => new ApiError(400, 'INVALID_WALLPAPER', '壁纸配置无效，请重新选择')
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid()
  }
  return value as Record<string, unknown>
}
function parseSource(value: unknown): WallpaperSource {
  const item = record(value)
  if (item.kind === 'builtin' && Object.keys(item).length === 2 && builtinWallpapers.some((wallpaper) => wallpaper.id === item.id)) {
    return { kind: 'builtin', id: String(item.id) }
  }
  if (item.kind === 'resource' && Object.keys(item).length === 2 && typeof item.resourceId === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(item.resourceId)) {
    return { kind: 'resource', resourceId: item.resourceId }
  }
  throw invalid()
}
export function parseWallpapers(value: unknown): DesktopWallpapers {
  const body = record(value)
  if (Object.keys(body).length !== targets.length || targets.some((target) => !Object.hasOwn(body, target))) {
    throw invalid()
  }
  return {
    common: parseSource(body.common),
    mobile: body.mobile === null ? null : parseSource(body.mobile),
    tablet: body.tablet === null ? null : parseSource(body.tablet),
    pc: body.pc === null ? null : parseSource(body.pc),
  }
}
const resourceIds = (wallpapers: DesktopWallpapers) => [...new Set(targets.flatMap((target) => {
  const item = wallpapers[target]
  return item?.kind === 'resource' ? [item.resourceId] : []
}))]
interface StoredAppearance { wallpapers: DesktopWallpapers | string, revision: number }
const snapshot = (row?: StoredAppearance): DesktopAppearanceSnapshot => ({
  revision: Number(row?.revision ?? 0),
  wallpapers: row ? parseWallpapers(typeof row.wallpapers === 'string' ? JSON.parse(row.wallpapers) : row.wallpapers) : defaultDesktopWallpapers(),
})

export class DesktopAppearanceService {
  constructor(private readonly source: DataSource) {}

  async get(userId: string): Promise<DesktopAppearanceSnapshot> {
    const [row] = await this.source.query('SELECT wallpapers,revision FROM user_desktop_appearance WHERE user_id=?', [userId])
    const current = snapshot(row)
    const ids = resourceIds(current.wallpapers)
    if (ids.length) {
      const rows: { id: string }[] = await this.source.query(`SELECT id FROM resources WHERE user_id=? AND deleted_at IS NULL AND mime_type IN ('image/png','image/jpeg','image/webp') AND id IN (${ids.map(() => '?').join(',')})`, [userId, ...ids])
      const visible = new Set(rows.map((resource) => resource.id))
      for (const target of targets) {
        const item = current.wallpapers[target]
        if (item?.kind === 'resource' && !visible.has(item.resourceId)) {
          if (target === 'common') {
            current.wallpapers.common = defaultDesktopWallpapers().common
          } else {
            current.wallpapers[target] = null
          }
        }
      }
    }
    return current
  }

  async save(userId: string, value: unknown): Promise<DesktopAppearanceSnapshot> {
    const body = record(value)
    if (Object.keys(body).some((key) => !['revision', 'wallpapers'].includes(key)) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) {
      throw invalid()
    }
    const wallpapers = parseWallpapers(body.wallpapers)
    return this.source.transaction(async (db) => {
      const users = await db.query('SELECT id FROM app_users WHERE id=? FOR UPDATE', [userId])
      if (!users.length) {
        throw new ApiError(401, 'UNAUTHENTICATED', '请重新登录')
      }
      const ids = resourceIds(wallpapers)
      if (ids.length) {
        const rows = await db.query(`SELECT id FROM resources WHERE user_id=? AND deleted_at IS NULL AND mime_type IN ('image/png','image/jpeg','image/webp') AND id IN (${ids.map(() => '?').join(',')}) FOR UPDATE`, [userId, ...ids])
        if (rows.length !== ids.length) {
          throw new ApiError(400, 'WALLPAPER_RESOURCE_UNAVAILABLE', '壁纸图片不存在、已删除或不属于当前账号')
        }
      }
      const [row] = await db.query('SELECT wallpapers,revision FROM user_desktop_appearance WHERE user_id=? FOR UPDATE', [userId])
      const current = snapshot(row)
      if (JSON.stringify(current.wallpapers) === JSON.stringify(wallpapers)) {
        return current
      }
      if (current.revision !== body.revision) {
        throw new ApiError(409, 'DESKTOP_APPEARANCE_CHANGED', '壁纸已在其他设备更新，请重新加载后设置')
      }
      const revision = current.revision + 1
      await db.query('INSERT INTO user_desktop_appearance(user_id,wallpapers,revision) VALUES(?,?,?) ON DUPLICATE KEY UPDATE wallpapers=VALUES(wallpapers),revision=VALUES(revision),updated_at=UTC_TIMESTAMP(3)', [userId, JSON.stringify(wallpapers), revision])
      return { wallpapers, revision }
    })
  }
}
