import type { LedgerRole } from '@t-box/ledger-contracts'
import type { DataSource, EntityManager } from 'typeorm'
import type { LedgerIdentityPort } from '../ports.js'
import type { Access, LedgerRow, Principal } from './types.js'
import { ApiError } from '@t-box/server-foundation/errors'

export type Capability = 'read' | 'write' | 'manage' | 'own'
const rank: Record<LedgerRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
}
const required: Record<Capability, number> = {
  read: 0,
  write: 1,
  manage: 2,
  own: 3,
}
export class LedgerAccess {
  readonly listeners = new Set<(id: string) => void>()
  notify(id: string) {
    for (const listener of this.listeners) {
      listener(id)
    }
  }

  constructor(
    readonly source: DataSource,
    readonly identity: LedgerIdentityPort,
  ) {}

  async check(
    principal: Principal,
    ledgerId: string,
    capability: Capability = 'read',
    allowLocked = false,
    db = this.source.manager,
    lock = false,
  ): Promise<Access> {
    await this.identity.authenticateHash(principal.sessionHash, db)
    const [book] = (await db.query(
      `SELECT * FROM ledgers WHERE id=?${lock ? ' FOR UPDATE' : ''}`,
      [ledgerId],
    )) as LedgerRow[]
    const [membership] = book
      ? await db.query(
          'SELECT role FROM ledger_members WHERE ledger_id=? AND user_id=?',
          [ledgerId, principal.user.id],
        )
      : []
    if (!book || !membership) {
      throw new ApiError(404, 'LEDGER_NOT_FOUND', '账本不存在或你已不再是成员')
    }
    const role = membership.role as LedgerRole
    if (rank[role] < required[capability]) {
      throw new ApiError(403, 'FORBIDDEN', '当前角色没有此操作权限')
    }
    if (book.archived && capability === 'write') {
      throw new ApiError(409, 'LEDGER_ARCHIVED', '账本已归档，仅可查看')
    }
    const unlocked = book.password_hash
      ? await db.query(
          'SELECT 1 FROM ledger_unlocks WHERE ledger_id=? AND session_hash=? AND password_version=? AND expires_at>UTC_TIMESTAMP(3) AND (?=\'read\' OR scope=\'write\')',
          [
            ledgerId,
            principal.sessionHash,
            book.password_version,
            capability === 'read' ? 'read' : 'write',
          ],
        )
      : [{}]
    const locked = !unlocked.length
    if (locked && !allowLocked) {
      throw new ApiError(423, 'LEDGER_LOCKED', '请先输入账本密码解锁')
    }
    return { book, role, locked }
  }

  async transaction<T>(
    principal: Principal,
    id: string,
    capability: Capability,
    work: (db: EntityManager, access: Access) => Promise<T>,
    allowLocked = false,
  ): Promise<T> {
    // Authentication reads happen before the book lock. Under REPEATABLE READ they
    // could establish an old snapshot while waiting, making aggregate limits stale.
    const result = await this.source.transaction('READ COMMITTED', async (db) =>
      work(
        db,
        await this.check(principal, id, capability, allowLocked, db, true),
      ))
    if (capability !== 'read') {
      this.notify(id)
    }
    return result
  }

  assertAuthor(role: LedgerRole, creator: string | null, userId: string) {
    if (role === 'editor' && creator !== userId) {
      throw new ApiError(403, 'FORBIDDEN', '记账成员只能修正自己创建的记录')
    }
  }
}
