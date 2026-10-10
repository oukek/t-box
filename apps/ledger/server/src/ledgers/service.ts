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
import { ApiError, invalid } from '@t-box/server-foundation/errors'
import { parseId } from '../validation.js'
import { audit } from './audit.js'
import { createLedgerRows } from './create.js'
import { isoTime } from './time.js'
import { ledgerInput, memberRole, object, text } from './validation.js'

export class LedgerService {
  constructor(readonly access: LedgerAccess) {}
  async list(principal: Principal): Promise<Ledger[]> {
    await this.access.identity.authenticateHash(principal.sessionHash)
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
    const id = await this.access.source.transaction(async (db) => {
      await this.access.identity.authenticateHash(principal.sessionHash, db)
      const [{ count }] = await db.query(
        'SELECT COUNT(*) AS count FROM ledgers WHERE owner_id=?',
        [principal.user.id],
      )
      if (Number(count) >= 100) {
        invalid('name', '每个账号最多创建 100 个账本')
      }
      const id = await createLedgerRows(db, principal.user.id, input, hash)
      if (hash) {
        await db.query(
          'INSERT INTO ledger_unlocks(ledger_id,session_hash,password_version,expires_at) VALUES(?,?,1,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE))',
          [id, principal.sessionHash],
        )
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
          throw new ApiError(403, 'PASSWORD_INCORRECT', '账本密码不正确')
        }
        await db.query(
          'INSERT INTO ledger_unlocks(ledger_id,session_hash,password_version,scope,expires_at) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)) ON DUPLICATE KEY UPDATE password_version=VALUES(password_version),scope=VALUES(scope),expires_at=VALUES(expires_at)',
          [id, principal.sessionHash, book.password_version, scope],
        )
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
        await db.query(
          'DELETE FROM ledger_unlocks WHERE ledger_id=? AND session_hash=?',
          [id, principal.sessionHash],
        )
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
        const [user] = await db.query(
          'SELECT password_hash FROM app_users WHERE id=?',
          [principal.user.id],
        )
        if (
          typeof input.accountPassword !== 'string' ||
          input.accountPassword.length > 128 ||
          !(await verifyPassword(input.accountPassword, user.password_hash))
        ) {
          invalid('accountPassword', '账号密码不正确')
        }
        await db.query(
          'UPDATE ledgers SET password_hash=?,password_version=password_version+1,revision=revision+1 WHERE id=?',
          [hash, id],
        )
        await db.query('DELETE FROM ledger_unlocks WHERE ledger_id=?', [id])
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
        await db.query(
          'UPDATE ledgers SET name=?,archived=?,revision=revision+1 WHERE id=?',
          [name ?? book.name, input.archived ?? book.archived, id],
        )
        await audit(db, id, principal.user.id, 'ledger.updated', id, input)
      },
    )
    return this.get(principal, id)
  }

  async members(principal: Principal, id: string): Promise<LedgerMember[]> {
    await this.access.check(principal, id)
    return this.access.source
      .query(
        'SELECT u.id AS userId,u.username,u.nickname,m.role,m.joined_at AS joinedAt FROM ledger_members m JOIN app_users u ON u.id=m.user_id WHERE m.ledger_id=? ORDER BY m.joined_at',
        [id],
      )
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
        const [target] = await db.query(
          'SELECT role FROM ledger_members WHERE ledger_id=? AND user_id=?',
          [id, userId],
        )
        if (!target) {
          throw new ApiError(404, 'MEMBER_NOT_FOUND', '成员不存在')
        }
        if (target.role === 'owner' || userId === principal.user.id) {
          invalid('role', '不能修改自己或账本所有者的角色')
        }
        if (
          access.role !== 'owner' &&
          (target.role === 'admin' || role === 'admin')
        ) {
          throw new ApiError(403, 'FORBIDDEN', '只有所有者可以管理管理员')
        }
        await db.query(
          'UPDATE ledger_members SET role=? WHERE ledger_id=? AND user_id=?',
          [role, id, userId],
        )
        await db.query('UPDATE ledgers SET revision=revision+1 WHERE id=?', [
          id,
        ])
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
        const [target] = await db.query(
          'SELECT role FROM ledger_members WHERE ledger_id=? AND user_id=?',
          [id, userId],
        )
        if (!target) {
          throw new ApiError(404, 'MEMBER_NOT_FOUND', '成员不存在')
        }
        if (target.role === 'owner') {
          invalid('member', '所有者需要先转让账本才能退出')
        }
        if (!own && access.role !== 'owner' && target.role === 'admin') {
          throw new ApiError(403, 'FORBIDDEN', '只有所有者可以移除管理员')
        }
        await db.query(
          'DELETE FROM ledger_members WHERE ledger_id=? AND user_id=?',
          [id, userId],
        )
        await db.query(
          'DELETE u FROM ledger_unlocks u JOIN user_sessions s ON s.token_hash=u.session_hash WHERE u.ledger_id=? AND s.user_id=?',
          [id, userId],
        )
        await db.query('UPDATE ledgers SET revision=revision+1 WHERE id=?', [
          id,
        ])
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
      const [target] = await db.query(
        'SELECT 1 FROM ledger_members WHERE ledger_id=? AND user_id=?',
        [id, userId],
      )
      if (!target) {
        invalid('userId', '请先邀请对方加入')
      }
      await db.query(
        'UPDATE ledger_members SET role=IF(user_id=?,\'owner\',\'admin\') WHERE ledger_id=? AND user_id IN (?,?)',
        [userId, id, userId, principal.user.id],
      )
      await db.query(
        'UPDATE ledgers SET owner_id=?,revision=revision+1 WHERE id=?',
        [userId, id],
      )
      await audit(db, id, principal.user.id, 'ledger.transferred', userId)
    })
    return this.get(principal, id)
  }

  async invites(principal: Principal, id: string): Promise<LedgerInvite[]> {
    await this.access.check(principal, id, 'manage')
    return this.access.source
      .query(
        'SELECT id,role,expires_at AS expiresAt,max_uses AS maxUses,uses,revoked FROM ledger_invites WHERE ledger_id=? ORDER BY expires_at DESC,id DESC LIMIT 100',
        [id],
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
          throw new ApiError(403, 'FORBIDDEN', '只有所有者可以邀请管理员')
        }
        await db.query(
          'INSERT INTO ledger_invites(id,ledger_id,token_hash,role,expires_at,max_uses,created_by) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? DAY),?,?)',
          [inviteId, id, digest(token), role, days, maxUses, principal.user.id],
        )
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
      const result = await db.query(
        'UPDATE ledger_invites SET revoked=TRUE WHERE id=? AND ledger_id=?',
        [inviteId, id],
      )
      if (!result.affectedRows) {
        throw new ApiError(404, 'INVITE_NOT_FOUND', '邀请不存在')
      }
      await audit(db, id, principal.user.id, 'invite.revoked', inviteId)
    })
    return { revoked: true }
  }

  async join(principal: Principal, value: unknown) {
    const input = object(value, ['token'])
    if (typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)) {
      invalid('token', '邀请链接无效')
    }
    const hash = digest(input.token)
    const [candidate] = await this.access.source.query(
      'SELECT ledger_id FROM ledger_invites WHERE token_hash=?',
      [hash],
    )
    if (!candidate) {
      throw new ApiError(404, 'INVITE_NOT_FOUND', '邀请不存在')
    }
    const id = candidate.ledger_id
    await this.access.source.transaction(async (db) => {
      await this.access.identity.authenticateHash(principal.sessionHash, db)
      const [book] = await db.query(
        'SELECT * FROM ledgers WHERE id=? FOR UPDATE',
        [id],
      )
      if (!book || book.archived) {
        invalid('token', '账本已归档，无法加入')
      }
      const [invite] = await db.query(
        'SELECT *,expires_at<=UTC_TIMESTAMP(3) AS expired FROM ledger_invites WHERE token_hash=?',
        [hash],
      )
      if (Number(invite.revoked) || Number(invite.expired)) {
        invalid('token', '邀请已失效')
      }
      const [member] = await db.query(
        'SELECT 1 FROM ledger_members WHERE ledger_id=? AND user_id=?',
        [id, principal.user.id],
      )
      if (member) {
        return
      }
      const [inviter] = await db.query(
        'SELECT role FROM ledger_members WHERE ledger_id=? AND user_id=?',
        [id, invite.created_by],
      )
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
      const [{ count }] = await db.query(
        'SELECT COUNT(*) AS count FROM ledger_members WHERE ledger_id=?',
        [id],
      )
      if (Number(count) >= 100) {
        invalid('token', '账本成员已满')
      }
      await db.query(
        'INSERT INTO ledger_members(ledger_id,user_id,role) VALUES(?,?,?)',
        [id, principal.user.id, invite.role],
      )
      await db.query('UPDATE ledger_invites SET uses=uses+1 WHERE id=?', [
        invite.id,
      ])
      await db.query('UPDATE ledgers SET revision=revision+1 WHERE id=?', [id])
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
      .query(
        'SELECT a.id,a.action,a.subject_id AS subjectId,a.details,a.created_at AS createdAt,u.nickname AS actor FROM ledger_audit a LEFT JOIN app_users u ON u.id=a.user_id WHERE a.ledger_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 100',
        [id],
      )
      .then((rows) =>
        rows.map((row: { createdAt: string }) => ({
          ...row,
          createdAt: isoTime(row.createdAt),
        })),
      )
  }
}
