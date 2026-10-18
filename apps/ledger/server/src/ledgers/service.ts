import type {
  Ledger,
  LedgerInvite,
  LedgerMember,
} from '@t-box/ledger-contracts'
import type { LedgerAccess } from './access.js'
import type { Principal } from './types.js'
import { randomBytes } from 'node:crypto'
import { password } from '@t-box/server-foundation/auth'
import {
  digest,
  hashPassword,
  verifyPassword,
} from '@t-box/server-foundation/crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { booleanValue } from '@t-box/server-foundation/input'
import { sqlClock } from '@t-box/server-foundation/persistence/columns'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import {
  LedgerEntity,
  LedgerInviteEntity,
  LedgerMemberEntity,
  LedgerUnlockEntity,
} from '../domain-entities.js'
import { ErrorCode } from '../error-codes.js'
import { parseId } from '../validation.js'
import { audit } from './audit.js'
import { createLedgerRows } from './create.js'
import { isoTime } from './time.js'
import { ledgerInput, memberRole, object, text } from './validation.js'

export class LedgerService {
  constructor(readonly access: LedgerAccess) {}
  async list(principal: Principal): Promise<Ledger[]> {
    await this.access.identity.authenticateHash(principal.sessionHash)
    // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
    return this.access.source
      .query(
        `SELECT l.id,l.name,l.template,l.currency,l.owner_id AS ownerId,m.role,l.archived,
      (l.password_hash IS NOT NULL) AS hasPassword,(l.password_hash IS NOT NULL AND u.session_hash IS NULL) AS locked,
      u.scope AS authorizationScope,l.revision,(SELECT COUNT(*) FROM ledger_members WHERE ledger_id=l.id) AS memberCount
      FROM ledgers l JOIN ledger_members m ON m.ledger_id=l.id AND m.user_id=?
      LEFT JOIN ledger_unlocks u ON u.ledger_id=l.id AND u.session_hash=? AND u.password_version=l.password_version AND u.expires_at>UTC_TIMESTAMP(3)
      ORDER BY l.archived,l.created_at,l.id`,
        [principal.user.id, principal.sessionHash],
      )
      .then((rows) =>
        rows.map((row: Ledger) => ({
          ...row,
          archived: Boolean(Number(row.archived)),
          hasPassword: Boolean(Number(row.hasPassword)),
          locked: Boolean(Number(row.locked)),
          revision: Number(row.revision),
          memberCount: Number(row.memberCount),
        })),
      )
  }

  async get(principal: Principal, id: string) {
    await this.access.check(principal, id, 'read', true)
    return (await this.list(principal)).find((book) => book.id === id)!
  }

  async create(principal: Principal, value: unknown) {
    const input = ledgerInput(value)
    const hash = input.password ? await hashPassword(input.password) : null
    const id = await this.access.source.transaction('READ COMMITTED', async (db) => {
      // The quota and insert must serialize across all books created by this user.
      await db
        .getRepository(AppUserEntity)
        .findOne({
          select: { id: true },
          where: { id: principal.user.id },
          lock: { mode: 'pessimistic_write' },
        })
      await this.access.identity.authenticateHash(principal.sessionHash, db)
      const count = await db
        .getRepository(LedgerEntity)
        .countBy({ ownerId: principal.user.id })
      if (count >= 100) {
        invalid('name', '每个账号最多创建 100 个账本')
      }
      const id = await createLedgerRows(db, principal.user.id, input, hash)
      if (hash) {
        await db.getRepository(LedgerUnlockEntity).insert({
          ledgerId: id,
          sessionHash: principal.sessionHash,
          passwordVersion: 1,
          expiresAt: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)',
        })
      }
      await audit(db, id, principal.user.id, 'ledger.created', id, {
        name: input.name,
        template: input.template,
      })
      return id
    })
    return this.get(principal, id)
  }

  async unlock(principal: Principal, id: string, value: unknown) {
    const input = object(value, ['password', 'scope'])
    const metadata = await this.access.check(principal, id, 'read', true)
    const scope =
      input.scope ??
      (metadata.role === 'viewer' || metadata.book.archived ? 'read' : 'write')
    if (scope !== 'read' && scope !== 'write') {
      invalid('scope', '授权范围无效')
    }
    this.access.identity.limit(`unlock:${principal.user.id}:${id}`, 10)
    await this.access.transaction(
      principal,
      id,
      scope,
      async (db, { book }) => {
        if (
          book.password_hash &&
          (typeof input.password !== 'string' ||
            input.password.length > 128 ||
            !(await verifyPassword(input.password, book.password_hash)))
        ) {
          throw ErrorCode.PASSWORD_INCORRECT()
        }
        await db
          .createQueryBuilder()
          .insert()
          .into('ledger_unlocks')
          .values({
            ledgerId: () => ':p0',
            sessionHash: () => ':p1',
            passwordVersion: () => ':p2',
            scope: () => ':p3',
            expiresAt: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)',
          })
          .updateEntity(false)
          .setParameters({
            p0: id,
            p1: principal.sessionHash,
            p2: book.password_version,
            p3: scope,
          })
          .orUpdate(['password_version', 'scope', 'expires_at'])
          .execute()
      },
      true,
    )
    return this.get(principal, id)
  }

  async lock(principal: Principal, id: string) {
    await this.access.transaction(
      principal,
      id,
      'read',
      async (db) => {
        await db
          .getRepository(LedgerUnlockEntity)
          .delete({ ledgerId: id, sessionHash: principal.sessionHash })
      },
      true,
    )
    return this.get(principal, id)
  }

  async password(principal: Principal, id: string, value: unknown) {
    const input = object(value, ['accountPassword', 'password'])
    const hash =
      input.password === null
        ? null
        : await hashPassword(password(input.password))
    await this.access.transaction(
      principal,
      id,
      'own',
      async (db) => {
        const user = await db
          .getRepository(AppUserEntity)
          .findOne({
            select: { passwordHash: true },
            where: { id: principal.user.id },
          })
          .then((row) => (row ? { password_hash: row.passwordHash } : null))
        if (
          !user ||
          typeof input.accountPassword !== 'string' ||
          input.accountPassword.length > 128 ||
          !(await verifyPassword(input.accountPassword, user.password_hash))
        ) {
          invalid('accountPassword', '账号密码不正确')
        }
        await db.getRepository(LedgerEntity).update(
          { id },
          {
            passwordHash: hash,
            passwordVersion: () => 'password_version+1',
            revision: () => 'revision+1',
          },
        )
        await db.getRepository(LedgerUnlockEntity).delete({ ledgerId: id })
        await audit(db, id, principal.user.id, 'ledger.password_changed', id, {
          enabled: !!hash,
        })
      },
      true,
    )
    return this.get(principal, id)
  }

  async update(principal: Principal, id: string, value: unknown) {
    const input = object(value, ['name', 'archived'])
    if (!Object.keys(input).length) {
      invalid('body', '请提供修改内容')
    }
    const name =
      input.name === undefined ? undefined : text(input.name, '账本名称', 40)
    if (input.archived !== undefined && typeof input.archived !== 'boolean') {
      invalid('archived', '归档状态无效')
    }
    await this.access.transaction(
      principal,
      id,
      'own',
      async (db, { book }) => {
        await db.getRepository(LedgerEntity).update(
          { id },
          {
            name: name ?? book.name,
            archived:
              input.archived === undefined
                ? Boolean(book.archived)
                : booleanValue(input.archived, 'archived'),
            revision: () => 'revision+1',
          },
        )
        await audit(db, id, principal.user.id, 'ledger.updated', id, input)
      },
    )
    return this.get(principal, id)
  }

  async members(principal: Principal, id: string): Promise<LedgerMember[]> {
    await this.access.check(principal, id)
    return this.access.source
      .createQueryBuilder()
      .select(
        'u.id AS userId,u.username,u.nickname,m.role,m.joined_at AS joinedAt',
      )
      .from('ledger_members', 'm')
      .innerJoin('app_users', 'u', 'u.id=m.user_id')
      .where('m.ledger_id=:p0')
      .orderBy('m.joined_at', 'ASC')
      .setParameters({ p0: id })
      .getRawMany()
      .then((rows) =>
        rows.map((row: LedgerMember) => ({
          ...row,
          joinedAt: isoTime(row.joinedAt),
        })),
      )
  }

  async changeMember(
    principal: Principal,
    id: string,
    userId: string,
    value: unknown,
  ) {
    const input = object(value, ['role'])
    const role = memberRole(input.role)
    await this.access.transaction(
      principal,
      id,
      'manage',
      async (db, access) => {
        const target = await db
          .getRepository(LedgerMemberEntity)
          .findOne({
            select: { role: true },
            where: { ledgerId: id, userId },
          })
          .then((row) => (row ? { role: row.role } : null))
        if (!target) {
          throw ErrorCode.MEMBER_NOT_FOUND()
        }
        if (target.role === 'owner' || userId === principal.user.id) {
          invalid('role', '不能修改自己或账本所有者的角色')
        }
        if (
          access.role !== 'owner' &&
          (target.role === 'admin' || role === 'admin')
        ) {
          throw ErrorCode.FORBIDDEN('只有所有者可以管理管理员')
        }
        await db
          .getRepository(LedgerMemberEntity)
          .update({ ledgerId: id, userId }, { role })
        await db
          .getRepository(LedgerEntity)
          .update({ id }, { revision: () => 'revision+1' })
        await audit(db, id, principal.user.id, 'member.role_changed', userId, {
          role,
        })
      },
    )
    return this.members(principal, id)
  }

  async removeMember(principal: Principal, id: string, userId: string) {
    const own = userId === principal.user.id
    await this.access.transaction(
      principal,
      id,
      own ? 'read' : 'manage',
      async (db, access) => {
        const target = await db
          .getRepository(LedgerMemberEntity)
          .findOne({
            select: { role: true },
            where: { ledgerId: id, userId },
          })
          .then((row) => (row ? { role: row.role } : null))
        if (!target) {
          throw ErrorCode.MEMBER_NOT_FOUND()
        }
        if (target.role === 'owner') {
          invalid('member', '所有者需要先转让账本才能退出')
        }
        if (!own && access.role !== 'owner' && target.role === 'admin') {
          throw ErrorCode.FORBIDDEN('只有所有者可以移除管理员')
        }
        await db
          .getRepository(LedgerMemberEntity)
          .delete({ ledgerId: id, userId })
        // native-sql: atomic multi-table authorization cleanup
        await db.query(
          'DELETE u FROM ledger_unlocks u JOIN user_sessions s ON s.token_hash=u.session_hash WHERE u.ledger_id=? AND s.user_id=?',
          [id, userId],
        )
        await db
          .getRepository(LedgerEntity)
          .update({ id }, { revision: () => 'revision+1' })
        await audit(
          db,
          id,
          principal.user.id,
          own ? 'member.left' : 'member.removed',
          userId,
        )
      },
      own,
    )
    return { removed: true }
  }

  async transfer(principal: Principal, id: string, value: unknown) {
    const input = object(value, ['userId'])
    const userId = parseId(input.userId)
    if (userId === principal.user.id) {
      invalid('userId', '请选择其他成员')
    }
    await this.access.transaction(principal, id, 'own', async (db) => {
      const target = await db
        .getRepository(LedgerMemberEntity)
        .findOne({
          select: { ledgerId: true },
          where: { ledgerId: id, userId },
        })
        .then((row) => (row ? { ledger_id: row.ledgerId } : null))
      if (!target) {
        invalid('userId', '请先邀请对方加入')
      }
      await db
        .createQueryBuilder()
        .update('ledger_members')
        .set({ role: () => 'IF(user_id=:p0,\'owner\',\'admin\')' })
        .updateEntity(false)
        .where('ledger_id=:p1 AND user_id IN (:p2,:p3)')
        .setParameters({
          p0: userId,
          p1: id,
          p2: userId,
          p3: principal.user.id,
        })
        .execute()
      await db
        .getRepository(LedgerEntity)
        .update({ id }, { ownerId: userId, revision: () => 'revision+1' })
      await audit(db, id, principal.user.id, 'ledger.transferred', userId)
    })
    return this.get(principal, id)
  }

  async invites(principal: Principal, id: string): Promise<LedgerInvite[]> {
    await this.access.check(principal, id, 'manage')
    return this.access.source
      .getRepository(LedgerInviteEntity)
      .find({
        select: {
          id: true,
          role: true,
          expiresAt: true,
          maxUses: true,
          uses: true,
          revoked: true,
        },
        where: { ledgerId: id },
        order: { expiresAt: 'DESC', id: 'DESC' },
        take: 100,
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          role: row.role,
          expiresAt: sqlClock(row.expiresAt),
          maxUses: row.maxUses,
          uses: row.uses,
          revoked: row.revoked,
        })),
      )
      .then((rows) =>
        rows.map((row: LedgerInvite) => ({
          ...row,
          revoked: Boolean(Number(row.revoked)),
        })),
      )
  }

  async invite(principal: Principal, id: string, value: unknown) {
    const input = object(value, ['role', 'maxUses', 'days'])
    const role = memberRole(input.role)
    const maxUses = Number(input.maxUses ?? 1)
    const days = Number(input.days ?? 1)
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 20) {
      invalid('maxUses', '使用次数须为 1–20')
    }
    if (!Number.isInteger(days) || days < 1 || days > 7) {
      invalid('days', '有效期须为 1–7 天')
    }
    const token = randomBytes(32).toString('hex')
    const { randomUUID } = await import('node:crypto')
    const inviteId = randomUUID()
    await this.access.transaction(
      principal,
      id,
      'manage',
      async (db, access) => {
        if (role === 'admin' && access.role !== 'owner') {
          throw ErrorCode.FORBIDDEN('只有所有者可以邀请管理员')
        }
        await db
          .createQueryBuilder()
          .insert()
          .into('ledger_invites')
          .values({
            id: inviteId,
            ledgerId: id,
            tokenHash: digest(token),
            role,
            expiresAt: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL :p4 DAY)',
            maxUses,
            createdBy: principal.user.id,
          })
          .updateEntity(false)
          .setParameters({ p4: days })
          .execute()
        await audit(db, id, principal.user.id, 'invite.created', inviteId, {
          role,
          days,
          maxUses,
        })
      },
    )
    return { id: inviteId, token, role, maxUses, days }
  }

  async revoke(principal: Principal, id: string, inviteId: string) {
    await this.access.transaction(principal, id, 'manage', async (db) => {
      const result = await db
        .getRepository(LedgerInviteEntity)
        .update({ id: inviteId, ledgerId: id }, { revoked: true })
      if (!result.affected) {
        throw ErrorCode.INVITE_NOT_FOUND()
      }
      await audit(db, id, principal.user.id, 'invite.revoked', inviteId)
    })
    return { revoked: true }
  }

  async join(principal: Principal, value: unknown) {
    const input = object(value, ['token'])
    if (
      typeof input.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.token)
    ) {
      invalid('token', '邀请链接无效')
    }
    const hash = digest(input.token)
    const candidate = await this.access.source
      .getRepository(LedgerInviteEntity)
      .findOne({ select: { ledgerId: true }, where: { tokenHash: hash } })
      .then((row) => (row ? { ledger_id: row.ledgerId } : null))
    if (!candidate) {
      throw ErrorCode.INVITE_NOT_FOUND()
    }
    const id = candidate.ledger_id
    await this.access.source.transaction(async (db) => {
      await this.access.identity.authenticateHash(principal.sessionHash, db)
      const book = await db
        .getRepository(LedgerEntity)
        .findOne({
          select: {
            id: true,
            name: true,
            template: true,
            currency: true,
            ownerId: true,
            archived: true,
            passwordHash: true,
            passwordVersion: true,
            revision: true,
            createdAt: true,
          },
          where: { id },
          lock: { mode: 'pessimistic_write' },
        })
        .then((row) =>
          row
            ? {
                id: row.id,
                name: row.name,
                template: row.template,
                currency: row.currency,
                owner_id: row.ownerId,
                archived: row.archived,
                password_hash: row.passwordHash,
                password_version: row.passwordVersion,
                revision: row.revision,
                created_at: sqlClock(row.createdAt),
              }
            : null,
        )
      if (!book || book.archived) {
        invalid('token', '账本已归档，无法加入')
      }
      const [invite] = await db
        .createQueryBuilder()
        .select(
          'id,ledger_id,token_hash,role,expires_at,max_uses,uses,revoked,created_by,expires_at<=UTC_TIMESTAMP(3) AS expired',
        )
        .from('ledger_invites', 'ledger_invites')
        .where('token_hash=:p0')
        .setParameters({ p0: hash })
        .getRawMany()
      if (Number(invite.revoked) || Number(invite.expired)) {
        invalid('token', '邀请已失效')
      }
      const member = await db
        .getRepository(LedgerMemberEntity)
        .findOne({
          select: { ledgerId: true },
          where: { ledgerId: id, userId: principal.user.id },
        })
        .then((row) => (row ? { ledger_id: row.ledgerId } : null))
      if (member) {
        return
      }
      const inviter = await db
        .getRepository(LedgerMemberEntity)
        .findOne({
          select: { role: true },
          where: { ledgerId: id, userId: invite.created_by },
        })
        .then((row) => (row ? { role: row.role } : null))
      if (
        !inviter ||
        !['owner', 'admin'].includes(inviter.role) ||
        (invite.role === 'admin' && inviter.role !== 'owner')
      ) {
        invalid('token', '邀请者不再有对应的邀请权限')
      }
      if (invite.uses >= invite.max_uses) {
        invalid('token', '邀请使用次数已用完')
      }
      const [{ count }] = await db
        .createQueryBuilder()
        .select('COUNT(*) AS count')
        .from('ledger_members', 'ledger_members')
        .where('ledger_id=:p0')
        .setParameters({ p0: id })
        .getRawMany()
      if (count >= 100) {
        invalid('token', '账本成员已满')
      }
      await db
        .getRepository(LedgerMemberEntity)
        .insert({ ledgerId: id, userId: principal.user.id, role: invite.role })
      await db
        .getRepository(LedgerInviteEntity)
        .update({ id: invite.id }, { uses: () => 'uses+1' })
      await db
        .getRepository(LedgerEntity)
        .update({ id }, { revision: () => 'revision+1' })
      await audit(
        db,
        id,
        principal.user.id,
        'member.joined',
        principal.user.id,
        { role: invite.role },
      )
    })
    this.access.notify(id)
    return this.get(principal, id)
  }

  async history(principal: Principal, id: string) {
    await this.access.check(principal, id)
    return this.access.source
      .createQueryBuilder()
      .select(
        'a.id,a.action,a.subject_id AS subjectId,a.details,a.created_at AS createdAt,u.nickname AS actor',
      )
      .from('ledger_audit', 'a')
      .leftJoin('app_users', 'u', 'u.id=a.user_id')
      .where('a.ledger_id=:p0')
      .orderBy('a.created_at', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .limit(100)
      .setParameters({ p0: id })
      .getRawMany()
      .then((rows) =>
        rows.map((row: { createdAt: string }) => ({
          ...row,
          createdAt: isoTime(row.createdAt),
        })),
      )
  }
}
