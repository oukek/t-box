import type { BabyProfile } from '@t-box/baby-diary-contracts'
import type { BabyDomain } from './domain.js'
import { randomUUID } from 'node:crypto'
import {
  BabyErrorCode,
  babyScopes,
  id,
  object,
  parseBaby,
  text,
} from '@t-box/baby-diary-contracts'
import { In } from 'typeorm'
import { babyColumns, memberColumns } from './access.js'
import { BabyMemberEntity, BabyProfileEntity } from './entities.js'

export class BabyProfiles {
  constructor(readonly domain: BabyDomain) {}
  async list(subject: string): Promise<BabyProfile[]> {
    const memberships = await this.domain.source
      .getRepository(BabyMemberEntity)
      .find({ select: memberColumns, where: { subject } })
    if (!memberships.length) {
      return []
    }
    const babies = await this.domain.source
      .getRepository(BabyProfileEntity)
      .find({
        select: babyColumns,
        where: { id: In(memberships.map((x) => x.babyId)) },
        order: { createdAt: 'ASC' },
      })
    return babies.map((baby) => {
      const member = memberships.find((x) => x.babyId === baby.id)!
      const manager = ['owner', 'admin'].includes(member.role)
      return {
        id: baby.id,
        name: baby.name,
        birthDate: baby.birthDate,
        sex: baby.sex,
        theme: baby.theme,
        timezone: baby.timezone,
        archived: baby.archived,
        revision: baby.revision,
        role: member.role,
        scopes: manager ? [...babyScopes] : member.scopes,
        allowExport: manager || member.allowExport,
        createdAt: baby.createdAt.toISOString(),
      }
    })
  }

  async create(subject: string, value: unknown, key: string) {
    const v = object(value, ['baby', 'displayName'])
    const input = parseBaby(v.baby)
    const displayName = text(v.displayName, '成员称呼', 40)
    return this.domain.mutate(
      subject,
      null,
      'baby.create',
      key,
      value,
      'write',
      undefined,
      async (db) => {
        if (
          (await db
            .getRepository(BabyProfileEntity)
            .countBy({ ownerSubject: subject })) >= 50
        ) {
          throw BabyErrorCode.BABY_INVALID_INPUT(
            '每个账号最多创建 50 个宝宝档案',
          )
        }
        const babyId = randomUUID()
        const now = new Date()
        await db.getRepository(BabyProfileEntity).insert({
          id: babyId,
          ...input,
          theme: input.theme ?? null,
          ownerSubject: subject,
          archived: false,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        })
        await db.getRepository(BabyMemberEntity).insert({
          babyId,
          subject,
          displayName,
          role: 'owner',
          scopes: [...babyScopes],
          allowExport: true,
          joinedAt: now,
        })
        await this.domain.audit(db, subject, babyId, 'baby.create', babyId)
        return this.domain.access.profile(subject, babyId, db)
      },
    )
  }

  async update(subject: string, value: unknown, key: string) {
    const v = object(value, ['babyId', 'revision', 'baby'])
    const babyId = id(v.babyId)
    const input = parseBaby(v.baby)
    return this.domain.mutate(
      subject,
      babyId,
      'baby.update',
      key,
      value,
      'manage',
      undefined,
      async (db) => {
        const { baby } = await this.domain.access.check(
          subject,
          babyId,
          'manage',
          undefined,
          'members',
          db,
        )
        this.domain.revision(baby.revision, v.revision)
        await db
          .getRepository(BabyProfileEntity)
          .update(
            { id: babyId },
            { ...input, revision: baby.revision + 1, updatedAt: new Date() },
          )
        return this.domain.access.profile(subject, babyId, db)
      },
    )
  }

  async archive(subject: string, value: unknown, key: string) {
    const v = object(value, ['babyId', 'revision', 'archived'])
    const babyId = id(v.babyId)
    if (typeof v.archived !== 'boolean') {
      throw BabyErrorCode.BABY_INVALID_INPUT()
    }
    const archived = v.archived
    return this.domain.mutate(
      subject,
      babyId,
      'baby.archive',
      key,
      value,
      'own',
      undefined,
      async (db) => {
        const { baby } = await this.domain.access.check(
          subject,
          babyId,
          'own',
          undefined,
          'members',
          db,
          true,
        )
        this.domain.revision(baby.revision, v.revision)
        await db
          .getRepository(BabyProfileEntity)
          .update(
            { id: babyId },
            { archived, revision: baby.revision + 1, updatedAt: new Date() },
          )
        return this.domain.access.profile(subject, babyId, db)
      },
    )
  }
}
