import type {
  DesktopAppearanceSnapshot,
  DesktopWallpapers,
  WallpaperSource,
} from '@t-box/app-contracts'
import type { DataSource } from 'typeorm'
import {
  builtinWallpapers,
  defaultDesktopWallpapers,
} from '@t-box/app-contracts'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { ResourceEntity } from '@t-box/server-foundation/persistence/resource-entity'
import { In, IsNull } from 'typeorm'
import { ErrorCode } from '../error-codes.js'
import { DesktopAppearanceEntity } from './entity.js'

const targets = ['common', 'mobile', 'tablet', 'pc'] as const
const invalid = () => ErrorCode.INVALID_WALLPAPER()
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid()
  }
  return value as Record<string, unknown>
}
function parseSource(value: unknown): WallpaperSource {
  const item = record(value)
  if (
    item.kind === 'builtin' &&
    Object.keys(item).length === 2 &&
    builtinWallpapers.some((wallpaper) => wallpaper.id === item.id)
  ) {
    return { kind: 'builtin', id: String(item.id) }
  }
  if (
    item.kind === 'resource' &&
    Object.keys(item).length === 2 &&
    typeof item.resourceId === 'string' &&
    /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(item.resourceId)
  ) {
    return { kind: 'resource', resourceId: item.resourceId }
  }
  throw invalid()
}
export function parseWallpapers(value: unknown): DesktopWallpapers {
  const body = record(value)
  if (
    Object.keys(body).length !== targets.length ||
    targets.some((target) => !Object.hasOwn(body, target))
  ) {
    throw invalid()
  }
  return {
    common: parseSource(body.common),
    mobile: body.mobile === null ? null : parseSource(body.mobile),
    tablet: body.tablet === null ? null : parseSource(body.tablet),
    pc: body.pc === null ? null : parseSource(body.pc),
  }
}
const resourceIds = (wallpapers: DesktopWallpapers) => [
  ...new Set(
    targets.flatMap((target) => {
      const item = wallpapers[target]
      return item?.kind === 'resource' ? [item.resourceId] : []
    }),
  ),
]
interface StoredAppearance {
  wallpapers: DesktopWallpapers | string
  revision: number
}
const snapshot = (
  row?: StoredAppearance | null,
): DesktopAppearanceSnapshot => ({
  revision: Number(row?.revision ?? 0),
  wallpapers: row
    ? parseWallpapers(
        typeof row.wallpapers === 'string'
          ? JSON.parse(row.wallpapers)
          : row.wallpapers,
      )
    : defaultDesktopWallpapers(),
})

export class DesktopAppearanceService {
  constructor(private readonly source: DataSource) {}

  async get(userId: string): Promise<DesktopAppearanceSnapshot> {
    const row = await this.source
      .getRepository(DesktopAppearanceEntity)
      .findOne({
        select: { wallpapers: true, revision: true },
        where: { userId },
      })
      .then((row) =>
        row
          ? {
              wallpapers: row.wallpapers,
              revision: row.revision,
            }
          : null,
      )
    const current = snapshot(row)
    const ids = resourceIds(current.wallpapers)
    if (ids.length) {
      const rows: { id: string }[] = await this.source
        .getRepository(ResourceEntity)
        .find({
          select: { id: true },
          where: {
            user_id: userId,
            deleted_at: IsNull(),
            mime_type: In(['image/png', 'image/jpeg', 'image/webp']),
            id: In(ids),
          },
        })
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

  async save(
    userId: string,
    value: unknown,
  ): Promise<DesktopAppearanceSnapshot> {
    const body = record(value)
    if (
      Object.keys(body).some(
        (key) => !['revision', 'wallpapers'].includes(key),
      ) ||
      !Number.isSafeInteger(body.revision) ||
      Number(body.revision) < 0
    ) {
      throw invalid()
    }
    const wallpapers = parseWallpapers(body.wallpapers)
    return this.source.transaction(async (db) => {
      const users = await db
        .getRepository(AppUserEntity)
        .find({
          select: { id: true },
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        })
        .then((rows) => rows.map((row) => ({ id: row.id })))
      if (!users.length) {
        throw ErrorCode.UNAUTHENTICATED()
      }
      const ids = resourceIds(wallpapers)
      if (ids.length) {
        const rows = await db.getRepository(ResourceEntity).find({
          select: { id: true },
          where: {
            user_id: userId,
            deleted_at: IsNull(),
            mime_type: In(['image/png', 'image/jpeg', 'image/webp']),
            id: In(ids),
          },
          lock: { mode: 'pessimistic_write' },
        })
        if (rows.length !== ids.length) {
          throw ErrorCode.WALLPAPER_RESOURCE_UNAVAILABLE()
        }
      }
      const row = await db
        .getRepository(DesktopAppearanceEntity)
        .findOne({
          select: { wallpapers: true, revision: true },
          where: { userId },
          lock: { mode: 'pessimistic_write' },
        })
        .then((row) =>
          row
            ? {
                wallpapers: row.wallpapers,
                revision: row.revision,
              }
            : null,
        )
      const current = snapshot(row)
      if (JSON.stringify(current.wallpapers) === JSON.stringify(wallpapers)) {
        return current
      }
      if (current.revision !== body.revision) {
        throw ErrorCode.DESKTOP_APPEARANCE_CHANGED()
      }
      const revision = current.revision + 1
      await db
        .createQueryBuilder()
        .insert()
        .into('user_desktop_appearance')
        .values({
          userId: () => ':p0',
          wallpapers: () => ':p1',
          revision: () => ':p2',
          updatedAt: () => 'UTC_TIMESTAMP(3)',
        })
        .updateEntity(false)
        .setParameters({
          p0: userId,
          p1: JSON.stringify(wallpapers),
          p2: revision,
        })
        .orUpdate(['wallpapers', 'revision', 'updated_at'])
        .execute()
      return { wallpapers, revision }
    })
  }
}
