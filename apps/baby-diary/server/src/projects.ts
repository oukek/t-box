import type {
  CreativeFrame,
  CreativeProject,
} from '@t-box/baby-diary-contracts'
import type { EntityManager } from 'typeorm'
import type { BabyDomain } from './domain.js'
import type { StoredBabyProject } from './entities.js'
import { randomUUID } from 'node:crypto'
import {
  BabyErrorCode,
  id,
  mediaScope,
  object,
  parseFrames,
  parseProject,
} from '@t-box/baby-diary-contracts'
import { In, IsNull, Not } from 'typeorm'
import { BabyFrameEntity, BabyProjectEntity } from './entities.js'

const columns = {
  id: true,
  babyId: true,
  title: true,
  template: true,
  visibility: true,
  settings: true,
  author: true,
  revision: true,
  frameCount: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const
const frameColumns = {
  id: true,
  projectId: true,
  assetId: true,
  date: true,
  caption: true,
  position: true,
  x: true,
  y: true,
  scale: true,
  rotation: true,
} as const
const dto = (r: StoredBabyProject): CreativeProject => ({
  id: r.id,
  babyId: r.babyId,
  title: r.title,
  template: r.template,
  visibility: r.visibility,
  settings: r.settings,
  author: r.author,
  revision: r.revision,
  frameCount: r.frameCount,
  createdAt: r.createdAt.toISOString(),
  deletedAt: r.deletedAt?.toISOString() ?? null,
})
export class BabyProjects {
  constructor(readonly domain: BabyDomain) {}
  async list(subject: string, value: unknown) {
    const v = object(value, ['babyId', 'trash'])
    const babyId = id(v.babyId)
    const { member } = await this.domain.access.check(
      subject,
      babyId,
      'read',
      'creative',
    )
    const trash = v.trash === true
    if (trash && !['owner', 'admin'].includes(member.role)) {
      throw BabyErrorCode.BABY_FORBIDDEN()
    }
    return (
      await this.domain.source.getRepository(BabyProjectEntity).find({
        select: columns,
        where: {
          babyId,
          deletedAt: trash ? Not(IsNull()) : IsNull(),
          ...(!['owner', 'admin'].includes(member.role)
            ? { visibility: 'members' as const }
            : {}),
        },
        order: { createdAt: 'DESC' },
        take: 200,
      })
    ).map(dto)
  }

  async row(
    db: EntityManager,
    babyId: string,
    projectId: string,
    trash = false,
  ) {
    const r = await db.getRepository(BabyProjectEntity).findOne({
      select: columns,
      where: {
        id: projectId,
        babyId,
        deletedAt: trash ? Not(IsNull()) : IsNull(),
      },
    })
    if (!r) {
      throw BabyErrorCode.BABY_PROJECT_NOT_FOUND()
    }
    return r
  }

  async get(subject: string, value: unknown) {
    const v = object(value, ['babyId', 'projectId'])
    const babyId = id(v.babyId)
    const projectId = id(v.projectId)
    const r = await this.row(this.domain.source.manager, babyId, projectId)
    await this.domain.access.check(
      subject,
      babyId,
      'read',
      'creative',
      r.visibility,
    )
    const rows = await this.domain.source.getRepository(BabyFrameEntity).find({
      select: frameColumns,
      where: { projectId },
      order: { position: 'ASC' },
      take: 1000,
    })
    const frames: CreativeFrame[] = rows.map(
      ({ projectId: _, position: __, ...frame }) => frame,
    )
    const assets = await this.domain.media.list(
      this.domain.source.manager,
      { type: mediaScope('creative', r.visibility), id: babyId },
      frames.map((x) => x.assetId),
    )
    return { project: dto(r), frames, assets }
  }

  async create(subject: string, value: unknown, key: string) {
    const v = object(value, ['babyId', 'project'])
    const babyId = id(v.babyId)
    const input = parseProject(v.project)
    return this.domain.mutate(
      subject,
      babyId,
      'projects.create',
      key,
      value,
      'write',
      'creative',
      async (db) => {
        await this.domain.access.check(
          subject,
          babyId,
          'write',
          'creative',
          input.visibility,
          db,
        )
        const now = new Date()
        const r: StoredBabyProject = {
          id: randomUUID(),
          babyId,
          ...input,
          author: subject,
          revision: 1,
          frameCount: 0,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        }
        await db.getRepository(BabyProjectEntity).insert(r)
        return dto(r)
      },
      async (db) => {
        await this.domain.access.check(
          subject,
          babyId,
          'write',
          'creative',
          input.visibility,
          db,
        )
      },
    )
  }

  async save(subject: string, value: unknown, key: string) {
    const v = object(value, [
      'babyId',
      'projectId',
      'revision',
      'project',
      'frames',
    ])
    const babyId = id(v.babyId)
    const projectId = id(v.projectId)
    const input = parseProject(v.project)
    const frames = parseFrames(v.frames)
    const authorize = async (db: EntityManager) => {
      const r = await this.row(db, babyId, projectId)
      const { member } = await this.domain.access.check(
        subject,
        babyId,
        'write',
        'creative',
        r.visibility,
        db,
      )
      this.domain.access.canEdit(member.role, r.author, subject)
    }
    return this.domain.mutate(
      subject,
      babyId,
      'projects.save',
      key,
      value,
      'write',
      'creative',
      async (db) => {
        const r = await this.row(db, babyId, projectId)
        this.domain.revision(r.revision, v.revision)
        if (r.visibility !== input.visibility) {
          throw BabyErrorCode.BABY_INVALID_INPUT(
            '项目可见范围创建后不能修改，请新建对应项目',
          )
        }
        const collisions = frames.length
          ? await db.getRepository(BabyFrameEntity).find({
              select: { id: true, projectId: true },
              where: { id: In(frames.map((x) => x.id)) },
            })
          : []
        if (collisions.some((x) => x.projectId !== projectId)) {
          throw BabyErrorCode.BABY_INVALID_INPUT('照片帧标识不属于当前项目')
        }
        const assets = await this.domain.media.list(
          db,
          { type: mediaScope('creative', input.visibility), id: babyId },
          frames.map((x) => x.assetId),
        )
        if (assets.some((x) => !x.mimeType.startsWith('image/'))) {
          throw BabyErrorCode.BABY_INVALID_INPUT('创意动画只支持照片')
        }
        await this.domain.media.claim(
          db,
          subject,
          { type: mediaScope('creative', input.visibility), id: babyId },
          frames.map((x) => x.assetId),
        )
        await db.getRepository(BabyFrameEntity).delete({ projectId })
        if (frames.length) {
          await db.getRepository(BabyFrameEntity).insert(
            frames.map((frame, position) => ({
              ...frame,
              projectId,
              position,
            })),
          )
        }
        await db.getRepository(BabyProjectEntity).update(
          { id: projectId, babyId },
          {
            ...input,
            frameCount: frames.length,
            revision: r.revision + 1,
            updatedAt: new Date(),
          },
        )
        return dto(await this.row(db, babyId, projectId))
      },
      authorize,
    )
  }

  async remove(subject: string, value: unknown, key: string, restore = false) {
    const v = object(value, ['babyId', 'projectId', 'revision'])
    const babyId = id(v.babyId)
    const projectId = id(v.projectId)
    return this.domain.mutate(
      subject,
      babyId,
      restore ? 'projects.restore' : 'projects.delete',
      key,
      value,
      restore ? 'manage' : 'write',
      'creative',
      async (db) => {
        const row = await this.row(db, babyId, projectId, restore)
        const { member } = await this.domain.access.check(
          subject,
          babyId,
          restore ? 'manage' : 'write',
          'creative',
          row.visibility,
          db,
        )
        this.domain.access.canEdit(member.role, row.author, subject)
        this.domain.revision(row.revision, v.revision)
        await db.getRepository(BabyProjectEntity).update(
          { id: projectId },
          {
            deletedAt: restore ? null : new Date(),
            revision: row.revision + 1,
            updatedAt: new Date(),
          },
        )
        return { id: projectId, restored: restore }
      },
    )
  }
}
