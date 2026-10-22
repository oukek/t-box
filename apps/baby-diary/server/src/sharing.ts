import type {
  BabyInvite,
  BabyMember,
  BabyRole,
} from '@t-box/baby-diary-contracts'
import type { EntityManager } from 'typeorm'
import type { BabyDomain } from './domain.js'
import type { StoredBabyInvite } from './entities.js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  BabyErrorCode,
  babyScopes,
  id,
  integer,
  object,
  parseScopes,
  text,
} from '@t-box/baby-diary-contracts'
import { babyColumns, memberColumns } from './access.js'
import {
  BabyInviteEntity,
  BabyMemberEntity,
  BabyProfileEntity,
} from './entities.js'

const columns = {
  id: true,
  babyId: true,
  role: true,
  scopes: true,
  allowExport: true,
  maxUses: true,
  uses: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const
const dto = (r: StoredBabyInvite): BabyInvite => ({
  id: r.id,
  role: r.role,
  scopes: r.scopes,
  allowExport: r.allowExport,
  maxUses: r.maxUses,
  uses: r.uses,
  expiresAt: r.expiresAt.toISOString(),
  revoked: !!r.revokedAt,
})
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex')
function subjectId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw BabyErrorCode.BABY_INVALID_INPUT('成员标识无效')
  }
  return value
}
function role(value: unknown): Exclude<BabyRole, 'owner'> {
  if (!['admin', 'editor', 'viewer'].includes(String(value))) {
    throw BabyErrorCode.BABY_INVALID_INPUT('成员角色无效')
  }
  return value as Exclude<BabyRole, 'owner'>
}
function bool(value: unknown) {
  if (typeof value !== 'boolean') {
    throw BabyErrorCode.BABY_INVALID_INPUT('导出权限无效')
  }
  return value
}
export class BabySharing {
  constructor(readonly domain: BabyDomain) {}
  async members(subject: string, value: unknown): Promise<BabyMember[]> {
    const v = object(value, ['babyId'])
    const babyId = id(v.babyId)
    await this.domain.access.check(
      subject,
      babyId,
      'manage',
      undefined,
      'members',
      this.domain.source.manager,
      true,
    )
    return (
      await this.domain.source.getRepository(BabyMemberEntity).find({
        select: memberColumns,
        where: { babyId },
        order: { joinedAt: 'ASC' },
      })
    ).map(({ babyId: _, joinedAt, ...m }) => ({
      ...m,
      joinedAt: joinedAt.toISOString(),
    }))
  }

  async invites(subject: string, value: unknown) {
    const v = object(value, ['babyId'])
    const babyId = id(v.babyId)
    await this.domain.access.check(
      subject,
      babyId,
      'manage',
      undefined,
      'members',
      this.domain.source.manager,
      true,
    )
    return (
      await this.domain.source.getRepository(BabyInviteEntity).find({
        select: columns,
        where: { babyId },
        order: { createdAt: 'DESC' },
        take: 100,
      })
    ).map(dto)
  }

  async invite(subject: string, value: unknown, key: string) {
    const v = object(value, [
      'babyId',
      'role',
      'scopes',
      'allowExport',
      'days',
      'maxUses',
    ])
    const babyId = id(v.babyId)
    const grantedRole = role(v.role)
    const scopes = parseScopes(v.scopes)
    const allowExport = bool(v.allowExport)
    const days = integer(v.days, '有效天数', 1, 30)
    const maxUses = integer(v.maxUses, '使用次数', 1, 100)
    const token = randomBytes(32).toString('base64url')
    let created = false
    const invite = await this.domain.mutate(
      subject,
      babyId,
      'sharing.invite',
      key,
      value,
      'manage',
      undefined,
      async (db) => {
        const { member } = await this.domain.access.check(
          subject,
          babyId,
          'manage',
          undefined,
          'members',
          db,
        )
        if (grantedRole === 'admin' && member.role !== 'owner') {
          throw BabyErrorCode.BABY_OWNER_REQUIRED()
        }
        const row: StoredBabyInvite = {
          id: randomUUID(),
          babyId,
          tokenHash: hash(token),
          role: grantedRole,
          scopes,
          allowExport,
          maxUses,
          uses: 0,
          expiresAt: new Date(Date.now() + days * 86400000),
          revokedAt: null,
          createdAt: new Date(),
        }
        await db.getRepository(BabyInviteEntity).insert(row)
        created = true
        return dto(row)
      },
      async (db) => {
        const { member } = await this.domain.access.check(
          subject,
          babyId,
          'manage',
          undefined,
          'members',
          db,
        )
        if (grantedRole === 'admin' && member.role !== 'owner') {
          throw BabyErrorCode.BABY_OWNER_REQUIRED()
        }
      },
    )
    return { invite, token: created ? token : null }
  }

  async revoke(subject: string, value: unknown, key: string) {
    const v = object(value, ['babyId', 'inviteId'])
    const babyId = id(v.babyId)
    const inviteId = id(v.inviteId)
    return this.domain.mutate(
      subject,
      babyId,
      'sharing.revoke',
      key,
      value,
      'manage',
      undefined,
      async (db) => {
        await db
          .getRepository(BabyInviteEntity)
          .update({ id: inviteId, babyId }, { revokedAt: new Date() })
        return { revoked: true }
      },
    )
  }

  async join(subject: string, value: unknown, key: string) {
    const v = object(value, ['token', 'displayName'])
    const token = text(v.token, '邀请码', 128)
    const displayName = text(v.displayName, '成员称呼', 40)
    const invite = await this.domain.source
      .getRepository(BabyInviteEntity)
      .findOne({ select: columns, where: { tokenHash: hash(token) } })
    if (!invite) {
      throw BabyErrorCode.BABY_INVITE_INVALID()
    }
    const babyId = invite.babyId
    // Joining locks the baby before invitation/member rows, matching all member changes.
    const guard = async (db: EntityManager) => {
      const baby = await db.getRepository(BabyProfileEntity).findOne({
        select: babyColumns,
        where: { id: babyId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!baby || baby.archived) {
        throw BabyErrorCode.BABY_INVITE_INVALID()
      }
      const prior = await db
        .getRepository(BabyMemberEntity)
        .findOne({ select: memberColumns, where: { babyId, subject } })
      if (prior) {
        return
      }
      const current = await db.getRepository(BabyInviteEntity).findOne({
        select: columns,
        where: { id: invite.id },
        lock: { mode: 'pessimistic_write' },
      })
      if (
        !current ||
        current.revokedAt ||
        current.expiresAt.getTime() <= Date.now() ||
        current.uses >= current.maxUses
      ) {
        throw BabyErrorCode.BABY_INVITE_INVALID()
      }
    }
    return this.domain.mutate(
      subject,
      null,
      'sharing.join',
      key,
      value,
      'read',
      undefined,
      async (db) => {
        const prior = await db
          .getRepository(BabyMemberEntity)
          .existsBy({ babyId, subject })
        if (!prior) {
          const current = await db
            .getRepository(BabyInviteEntity)
            .findOneOrFail({ select: columns, where: { id: invite.id } })
          await db.getRepository(BabyMemberEntity).insert({
            babyId,
            subject,
            displayName,
            role: current.role,
            scopes: current.scopes,
            allowExport: current.allowExport,
            joinedAt: new Date(),
          })
          await db
            .getRepository(BabyInviteEntity)
            .increment({ id: invite.id }, 'uses', 1)
          await db
            .getRepository(BabyProfileEntity)
            .increment({ id: babyId }, 'revision', 1)
          await this.domain.audit(db, subject, babyId, 'sharing.join', subject)
        }
        return this.domain.access.profile(subject, babyId, db)
      },
      guard,
    )
  }

  async update(subject: string, value: unknown, key: string) {
    const v = object(value, [
      'babyId',
      'subject',
      'role',
      'scopes',
      'allowExport',
    ])
    const babyId = id(v.babyId)
    const target = subjectId(v.subject)
    const grantedRole = role(v.role)
    const scopes = parseScopes(v.scopes)
    const allowExport = bool(v.allowExport)
    const guard = async (db: EntityManager) => {
      const { member } = await this.domain.access.check(
        subject,
        babyId,
        'manage',
        undefined,
        'members',
        db,
      )
      const current = await db
        .getRepository(BabyMemberEntity)
        .findOne({ select: memberColumns, where: { babyId, subject: target } })
      if (!current || current.role === 'owner' || subject === target) {
        throw BabyErrorCode.BABY_MEMBER_INVALID()
      }
      if (
        member.role !== 'owner' &&
        (current.role === 'admin' || grantedRole === 'admin')
      ) {
        throw BabyErrorCode.BABY_OWNER_REQUIRED()
      }
    }
    return this.domain.mutate(
      subject,
      babyId,
      'sharing.update',
      key,
      value,
      'manage',
      undefined,
      async (db) => {
        await db
          .getRepository(BabyMemberEntity)
          .update(
            { babyId, subject: target },
            { role: grantedRole, scopes, allowExport },
          )
        return { updated: true }
      },
      guard,
    )
  }

  async remove(subject: string, value: unknown, key: string) {
    const v = object(value, ['babyId', 'subject'])
    const babyId = id(v.babyId)
    const target = subjectId(v.subject)
    return this.domain.mutate(
      subject,
      babyId,
      'sharing.remove',
      key,
      value,
      subject === target ? 'read' : 'manage',
      undefined,
      async (db) => {
        const { member } = await this.domain.access.check(
          subject,
          babyId,
          subject === target ? 'read' : 'manage',
          undefined,
          'members',
          db,
        )
        const current = await db.getRepository(BabyMemberEntity).findOne({
          select: memberColumns,
          where: { babyId, subject: target },
        })
        if (!current) {
          return { removed: true }
        }
        if (current.role === 'owner') {
          throw BabyErrorCode.BABY_MEMBER_INVALID()
        }
        if (
          current.role === 'admin' &&
          member.role !== 'owner' &&
          subject !== target
        ) {
          throw BabyErrorCode.BABY_OWNER_REQUIRED()
        }
        await db
          .getRepository(BabyMemberEntity)
          .delete({ babyId, subject: target })
        return { removed: true }
      },
    )
  }

  async transfer(subject: string, value: unknown, key: string) {
    const v = object(value, ['babyId', 'subject'])
    const babyId = id(v.babyId)
    const target = subjectId(v.subject)
    return this.domain.mutate(
      subject,
      babyId,
      'baby.transfer',
      key,
      value,
      'own',
      undefined,
      async (db) => {
        const next = await db.getRepository(BabyMemberEntity).findOne({
          select: memberColumns,
          where: { babyId, subject: target },
        })
        if (!next || subject === target) {
          throw BabyErrorCode.BABY_MEMBER_INVALID('请先邀请接收者加入档案')
        }
        await db
          .getRepository(BabyMemberEntity)
          .update({ babyId, subject }, { role: 'admin' })
        await db
          .getRepository(BabyMemberEntity)
          .update(
            { babyId, subject: target },
            { role: 'owner', scopes: [...babyScopes], allowExport: true },
          )
        await db
          .getRepository(BabyProfileEntity)
          .update({ id: babyId }, { ownerSubject: target })
        await db
          .getRepository(BabyProfileEntity)
          .increment({ id: babyId }, 'revision', 1)
        return { transferred: true }
      },
    )
  }
}
