import type { ApplicationFileContent } from '@t-box/app-contracts'
import type { Actor } from '@t-box/app-server-sdk'
import type {
  PrivateMediaFile,
  PrivateMediaPolicy,
  PrivateMediaPort,
  PrivateMediaScope,
  StoredPrivateFile,
} from '@t-box/server-foundation/persistence/private-media'
import type { DataSource } from 'typeorm'
import type { ApplicationPlatform } from '../application-platform/service.js'
import type { ResourceStorageRegistry } from './storage.js'
import { randomUUID } from 'node:crypto'
import {
  PrivateFileEntity,
  PrivateFileQuotaEntity,
} from '@t-box/server-foundation/persistence/private-media'
import sharp from 'sharp'
import { In, IsNull, LessThan } from 'typeorm'
import { ApplicationInstallationEntity } from '../db/records/index.js'
import { ErrorCode } from '../error-codes.js'
import { runtimePrivateStorage } from './private-storage.js'
import { detectMime, MAX_RESOURCE_SIZE } from './service.js'

const selection = {
  id: true,
  appId: true,
  scopeType: true,
  scopeId: true,
  uploadedBy: true,
  name: true,
  mimeType: true,
  size: true,
  storageBackend: true,
  objectPath: true,
  previewPath: true,
  linkedAt: true,
  deletedAt: true,
  purgedAt: true,
  createdAt: true,
} as const
const dto = (file: StoredPrivateFile): PrivateMediaFile => ({
  id: file.id,
  name: file.name,
  mimeType: file.mimeType,
  size: file.size,
  source: 'uploaded',
  createdAt: file.createdAt.toISOString(),
})
export function parsePrivateScope(value: unknown): PrivateMediaScope {
  const v = value as PrivateMediaScope
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((key) => !['type', 'id'].includes(key)) ||
    typeof v.type !== 'string' ||
    !/^[a-z][a-z0-9-]{0,39}$/.test(v.type) ||
    typeof v.id !== 'string' ||
    !/^[\w-]{1,80}$/.test(v.id)
  ) {
    throw ErrorCode.PRIVATE_MEDIA_SCOPE_INVALID()
  }
  return { type: v.type, id: v.id }
}
export class PrivateApplicationFiles {
  private readonly policies = new Map<string, PrivateMediaPolicy>()
  constructor(
    readonly source: DataSource,
    readonly applications: ApplicationPlatform,
    readonly storage:
      ResourceStorageRegistry | undefined = runtimePrivateStorage(),
  ) {}

  bind(appId: string, policy: PrivateMediaPolicy) {
    if (this.policies.has(appId)) {
      throw ErrorCode.PRIVATE_MEDIA_SCOPE_INVALID()
    }
    this.policies.set(appId, policy)
  }

  private policy(appId: string) {
    const policy = this.policies.get(appId)
    if (!policy) {
      throw ErrorCode.PRIVATE_MEDIA_FORBIDDEN()
    }
    return policy
  }

  private async subject(actor: Actor, appId: string) {
    const { installation } = await this.applications.assertActive(
      actor.user.id,
      appId,
    )
    if (!installation.grants.includes('files.private')) {
      throw ErrorCode.PRIVATE_MEDIA_FORBIDDEN()
    }
    return this.applications.subject(actor.user.id, appId)
  }

  port(appId: string): PrivateMediaPort {
    return {
      claim: async (db, subject, scope, ids) => {
        await this.policy(appId).authorize(subject, scope, 'write', db)
        const rows = ids.length
          ? await db.getRepository(PrivateFileEntity).find({
              select: selection,
              where: {
                id: In([...new Set(ids)]),
                appId,
                scopeType: scope.type,
                scopeId: scope.id,
                deletedAt: IsNull(),
              },
              lock: { mode: 'pessimistic_write' },
            })
          : []
        if (
          rows.length !== new Set(ids).size ||
          rows.some((row) => !row.linkedAt && row.uploadedBy !== subject)
        ) {
          throw ErrorCode.PRIVATE_MEDIA_FORBIDDEN()
        }
        if (ids.length) {
          await db
            .getRepository(PrivateFileEntity)
            .update({ id: In([...ids]), appId }, { linkedAt: new Date() })
        }
      },
      list: async (db, scope, ids) =>
        ids.length
          ? (
              await db.getRepository(PrivateFileEntity).find({
                select: selection,
                where: {
                  id: In([...ids]),
                  appId,
                  scopeType: scope.type,
                  scopeId: scope.id,
                  deletedAt: IsNull(),
                },
              })
            ).map(dto)
          : [],
    }
  }

  async upload(
    actor: Actor,
    appId: string,
    rawScope: unknown,
    filename: string,
    bytes: Buffer,
  ) {
    if (!bytes.length || bytes.length > MAX_RESOURCE_SIZE) {
      throw ErrorCode.RESOURCE_SIZE()
    }
    const scope = parsePrivateScope(rawScope)
    const subject = await this.subject(actor, appId)
    const expected = (
      await this.applications.assertActive(actor.user.id, appId)
    ).installation
    await this.policy(appId).authorize(
      subject,
      scope,
      'write',
      this.source.manager,
    )
    if (!this.storage) {
      throw ErrorCode.PRIVATE_MEDIA_CONFIG_REQUIRED()
    }
    let mimeType = 'application/octet-stream'
    try {
      mimeType = detectMime(bytes)
    } catch {
      /* Unknown file types stay downloads, never inline executable HTML/SVG. */
    }
    if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
      mimeType = 'image/gif'
    }
    let preview: Buffer | undefined
    const heic =
      bytes.toString('ascii', 4, 8) === 'ftyp' &&
      /hei[cf]|mif1|avif/.test(bytes.toString('ascii', 8, 32))
    if (mimeType.startsWith('image/') || heic) {
      try {
        preview = await sharp(bytes, {
          limitInputPixels: 40000000,
          animated: false,
        })
          .rotate()
          .resize({
            width: 2400,
            height: 2400,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 88 })
          .toBuffer()
        if (heic) {
          mimeType = /avif|avis/.test(bytes.toString('ascii', 8, 32))
            ? 'image/avif'
            : 'image/heic'
        }
      } catch {
        throw ErrorCode.PRIVATE_MEDIA_INVALID_IMAGE()
      }
    }
    const name =
      filename
        .split(/[\\/]/)
        .at(-1)
        ?.split('')
        .filter((character) => character.charCodeAt(0) >= 32)
        .join('')
        .trim()
        .slice(0, 200) || '未命名文件'
    const storage = this.storage.get(this.storage.activeId)
    const id = randomUUID()
    const path = storage.path?.(id) ?? id
    const previewId = preview ? randomUUID() : undefined
    const previewPath = previewId
      ? (storage.path?.(previewId) ?? previewId)
      : null
    await storage.write(path, bytes, { name, mimeType })
    try {
      if (preview && previewPath) {
        await storage.write(previewPath, preview, {
          name: 'preview.jpg',
          mimeType: 'image/jpeg',
        })
      }
      return await this.source.transaction('READ COMMITTED', async (db) => {
        // Fence installation first, then domain/quota/files. Uninstall cannot race the upload commit.
        const installation = await db
          .getRepository(ApplicationInstallationEntity)
          .findOne({
            select: { status: true, release_id: true, generation: true },
            where: { user_id: actor.user.id, app_id: appId },
            lock: { mode: 'pessimistic_write' },
          })
        if (
          installation?.status !== 'active' ||
          installation.release_id !== expected.releaseId ||
          Number(installation.generation) !== expected.generation
        ) {
          throw ErrorCode.PRIVATE_MEDIA_FORBIDDEN()
        }
        await this.policy(appId).authorize(subject, scope, 'write', db)
        await db
          .getRepository(PrivateFileQuotaEntity)
          .createQueryBuilder()
          .insert()
          .values({ appId, scopeId: scope.id, bytes: '0', files: 0 })
          .orIgnore()
          .execute()
        const quota = await db
          .getRepository(PrivateFileQuotaEntity)
          .findOneOrFail({
            where: { appId, scopeId: scope.id },
            lock: { mode: 'pessimistic_write' },
          })
        const size = bytes.length + (preview?.length ?? 0)
        if (quota.files >= 5000 || Number(quota.bytes) + size > 2 * 1024 ** 3) {
          throw ErrorCode.PRIVATE_MEDIA_QUOTA()
        }
        await db.getRepository(PrivateFileQuotaEntity).update(
          { appId, scopeId: scope.id },
          {
            files: quota.files + 1,
            bytes: String(Number(quota.bytes) + size),
          },
        )
        const file: StoredPrivateFile = {
          id,
          appId,
          scopeType: scope.type,
          scopeId: scope.id,
          uploadedBy: subject,
          name,
          mimeType,
          size,
          storageBackend: this.storage!.activeId,
          objectPath: path,
          previewPath,
          linkedAt: null,
          deletedAt: null,
          purgedAt: null,
          createdAt: new Date(),
        }
        await db.getRepository(PrivateFileEntity).insert(file)
        return dto(file)
      })
    } catch (error) {
      await Promise.allSettled([
        storage.remove(path),
        ...(previewPath ? [storage.remove(previewPath)] : []),
      ])
      throw error
    }
  }

  async read(
    actor: Actor,
    appId: string,
    id: string,
    original = false,
  ): Promise<ApplicationFileContent> {
    const subject = await this.subject(actor, appId)
    const file = await this.source.getRepository(PrivateFileEntity).findOne({
      select: selection,
      where: { id, appId, deletedAt: IsNull() },
    })
    if (!file) {
      throw ErrorCode.PRIVATE_MEDIA_MISSING()
    }
    const scope = { type: file.scopeType, id: file.scopeId }
    const needsOriginal = original || !file.previewPath
    await this.policy(appId).authorize(
      subject,
      scope,
      needsOriginal ? 'export' : 'read',
      this.source.manager,
    )
    if (!file.linkedAt && file.uploadedBy !== subject) {
      throw ErrorCode.PRIVATE_MEDIA_FORBIDDEN()
    }
    if (!this.storage) {
      throw ErrorCode.PRIVATE_MEDIA_CONFIG_REQUIRED()
    }
    const preview = !original && !!file.previewPath
    const bytes = await this.storage
      .get(file.storageBackend)
      .read(preview ? file.previewPath! : file.objectPath)
    await this.subject(actor, appId)
    await this.policy(appId).authorize(
      subject,
      scope,
      needsOriginal ? 'export' : 'read',
      this.source.manager,
    )
    return {
      file: {
        ...dto(file),
        size: bytes.length,
        ...(preview ? { mimeType: 'image/jpeg' } : {}),
      },
      base64: bytes.toString('base64'),
    }
  }

  async purgeDrafts() {
    const files = await this.source.getRepository(PrivateFileEntity).find({
      select: selection,
      where: [
        {
          linkedAt: IsNull(),
          createdAt: LessThan(new Date(Date.now() - 24 * 3600000)),
          deletedAt: IsNull(),
        },
        { deletedAt: LessThan(new Date()), purgedAt: IsNull() },
      ],
      take: 100,
    })
    for (const file of files) {
      const remove = await this.source.transaction(async (db) => {
        const row = await db.getRepository(PrivateFileEntity).findOne({
          select: selection,
          where: { id: file.id },
          lock: { mode: 'pessimistic_write' },
        })
        if (!row || row.purgedAt || (row.linkedAt && !row.deletedAt)) {
          return false
        }
        if (!row.deletedAt) {
          await db
            .getRepository(PrivateFileEntity)
            .update({ id: row.id }, { deletedAt: new Date() })
        }
        return true
      })
      if (!remove || !this.storage) {
        continue
      }
      try {
        const store = this.storage.get(file.storageBackend)
        await store.remove(file.objectPath)
        if (file.previewPath) {
          await store.remove(file.previewPath)
        }
        await this.source.transaction(async (db) => {
          const row = await db.getRepository(PrivateFileEntity).findOne({
            select: selection,
            where: { id: file.id },
            lock: { mode: 'pessimistic_write' },
          })
          if (!row || row.purgedAt) {
            return
          }
          const quota = await db.getRepository(PrivateFileQuotaEntity).findOne({
            where: { appId: row.appId, scopeId: row.scopeId },
            lock: { mode: 'pessimistic_write' },
          })
          if (quota) {
            await db.getRepository(PrivateFileQuotaEntity).update(
              { appId: row.appId, scopeId: row.scopeId },
              {
                files: Math.max(0, quota.files - 1),
                bytes: String(Math.max(0, Number(quota.bytes) - row.size)),
              },
            )
          }
          await db
            .getRepository(PrivateFileEntity)
            .update({ id: row.id }, { purgedAt: new Date() })
        })
      } catch {
        /* Tombstones remain for retry; no private object keys or credentials are logged. */
      }
    }
  }
}
