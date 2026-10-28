import type { Actor } from '@t-box/app-server-sdk'
import type { ResourceService } from '../resources/service.js'
import type { IdentityService } from './service.js'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { ResourceEntity } from '@t-box/server-foundation/persistence/resource-entity'
import { parseId } from '@t-box/server-foundation/validation'
import sharp from 'sharp'
import { IsNull } from 'typeorm'
import { ErrorCode } from '../error-codes.js'
import { detectMime } from '../resources/service.js'
import { UserProfileEntity } from './profile-entity.js'

export class AvatarService {
  constructor(private readonly identity: IdentityService, private readonly resources: ResourceService) {}

  async upload(actor: Actor, bytes: Buffer) {
    let avatar: Buffer
    try {
      if (!bytes.length || bytes.length > 2 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(detectMime(bytes))) {
        throw ErrorCode.PROFILE_AVATAR_INVALID()
      }
      avatar = await sharp(bytes, { limitInputPixels: 20_000_000 }).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 82 }).toBuffer()
    } catch {
      throw ErrorCode.PROFILE_AVATAR_INVALID()
    }
    const resource = await this.resources.create(actor, '头像.webp', avatar)
    const origin = this.resources.publicOrigin
    const avatarUrl = origin && resource.path ? new URL(resource.path, `${origin}/`).href : `/api/v1/users/${actor.user.id}/avatar?v=${resource.id}`
    let previous: string | null = null
    try {
      await this.identity.source.transaction(async (db) => {
        await this.identity.authenticateHash(actor.sessionHash, db)
        await db.getRepository(AppUserEntity).findOne({ where: { id: actor.user.id }, lock: { mode: 'pessimistic_write' } })
        previous = (await db.getRepository(UserProfileEntity).findOneBy({ userId: actor.user.id }))?.avatarResourceId ?? null
        await db.getRepository(UserProfileEntity).upsert({ userId: actor.user.id, avatarResourceId: resource.id, avatarUrl }, ['userId'])
      })
    } catch (error) {
      await this.resources.remove(actor, resource.id).catch(() => {})
      throw error
    }
    if (previous) {
      await this.resources.remove(actor, previous).catch(() => {})
    }
    return (await this.identity.authenticateHash(actor.sessionHash)).user
  }

  async reset(actor: Actor) {
    let previous: string | null = null
    await this.identity.source.transaction(async (db) => {
      await this.identity.authenticateHash(actor.sessionHash, db)
      await db.getRepository(AppUserEntity).findOne({ where: { id: actor.user.id }, lock: { mode: 'pessimistic_write' } })
      previous = (await db.getRepository(UserProfileEntity).findOneBy({ userId: actor.user.id }))?.avatarResourceId ?? null
      await db.getRepository(UserProfileEntity).upsert({ userId: actor.user.id, avatarResourceId: null, avatarUrl: '' }, ['userId'])
    })
    if (previous) {
      await this.resources.remove(actor, previous).catch(() => {})
    }
    return (await this.identity.authenticateHash(actor.sessionHash)).user
  }

  /** Avatars are public profile images; only processed profile-bound images are served. */
  async read(userId: string) {
    const profile = await this.identity.source.getRepository(UserProfileEntity).findOneBy({ userId: parseId(userId) })
    if (!profile?.avatarResourceId || !await this.identity.source.getRepository(AppUserEntity).existsBy({ id: userId, enabled: true }) || !await this.identity.source.getRepository(ResourceEntity).existsBy({ id: profile.avatarResourceId, user_id: userId, deleted_at: IsNull(), mime_type: 'image/webp' })) {
      throw ErrorCode.RESOURCE_NOT_FOUND()
    }
    return (await this.resources.bytes({ user: { id: userId }, sessionHash: '' } as Actor, profile.avatarResourceId)).bytes
  }
}
