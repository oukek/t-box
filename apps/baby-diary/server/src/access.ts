import type {
  BabyProfile,
  BabyRole,
  BabyScope,
  BabyVisibility,
} from '@t-box/baby-diary-contracts'
import type { DataSource, EntityManager } from 'typeorm'
import { BabyErrorCode, babyScopes, id } from '@t-box/baby-diary-contracts'
import { BabyMemberEntity, BabyProfileEntity } from './entities.js'

export const babyColumns = {
  id: true,
  name: true,
  birthDate: true,
  sex: true,
  theme: true,
  timezone: true,
  ownerSubject: true,
  archived: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
} as const
export const memberColumns = {
  babyId: true,
  subject: true,
  displayName: true,
  role: true,
  scopes: true,
  allowExport: true,
  joinedAt: true,
} as const
const rank: Record<BabyRole, number> = {
  owner: 3,
  admin: 2,
  editor: 1,
  viewer: 0,
}
export type BabyAction = 'read' | 'write' | 'manage' | 'own' | 'export'
export class BabyAccess {
  constructor(readonly source: DataSource) {}
  async check(
    subject: string,
    babyId: string,
    action: BabyAction = 'read',
    scope?: BabyScope,
    visibility: BabyVisibility = 'members',
    db: EntityManager = this.source.manager,
    allowArchived = false,
  ) {
    const baby = await db.getRepository(BabyProfileEntity).findOne({
      select: babyColumns,
      where: { id: id(babyId) },
      ...(db.queryRunner?.isTransactionActive
        ? { lock: { mode: 'pessimistic_write' as const } }
        : {}),
    })
    const member = baby
      ? await db
          .getRepository(BabyMemberEntity)
          .findOne({ select: memberColumns, where: { babyId, subject } })
      : null
    if (!baby || !member) {
      throw BabyErrorCode.BABY_NOT_FOUND()
    }
    if (
      (action === 'own' && member.role !== 'owner') ||
      (action === 'manage' && rank[member.role] < 2) ||
      (action === 'write' && rank[member.role] < 1) ||
      (visibility === 'managers' && rank[member.role] < 2) ||
      (scope && rank[member.role] < 2 && !member.scopes.includes(scope)) ||
      (action === 'export' && !member.allowExport && rank[member.role] < 2)
    ) {
      throw BabyErrorCode.BABY_FORBIDDEN()
    }
    if (
      baby.archived &&
      !allowArchived &&
      action !== 'read' &&
      action !== 'export' &&
      action !== 'own'
    ) {
      throw BabyErrorCode.BABY_ARCHIVED()
    }
    return { baby, member }
  }

  async profile(
    subject: string,
    babyId: string,
    db = this.source.manager,
  ): Promise<BabyProfile> {
    const { baby, member } = await this.check(
      subject,
      babyId,
      'read',
      undefined,
      'members',
      db,
    )
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
      scopes: rank[member.role] >= 2 ? [...babyScopes] : member.scopes,
      allowExport: rank[member.role] >= 2 || member.allowExport,
      createdAt: baby.createdAt.toISOString(),
    }
  }

  canEdit(role: BabyRole, creator: string, subject: string) {
    if (rank[role] < 1 || (role === 'editor' && creator !== subject)) {
      throw BabyErrorCode.BABY_FORBIDDEN('只能修改或删除自己创建的记录')
    }
  }
}
