import type { LedgerRole } from '@t-box/ledger-contracts'
import type { DataSource, EntityManager } from 'typeorm'
import type { LedgerIdentityPort } from '../ports.js'
import type { Access, LedgerRow, Principal } from './types.js'
import { Raw } from 'typeorm'
import { LedgerEntity, LedgerMemberEntity, LedgerUnlockEntity } from '../domain-entities.js'
import { ErrorCode } from '../error-codes.js'

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
    const stored = await db.getRepository(LedgerEntity).findOne({
      select: { id: true, name: true, template: true, currency: true, ownerId: true, archived: true, passwordHash: true, passwordVersion: true, revision: true },
      where: { id: ledgerId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    })
    const book: LedgerRow | null = stored
      ? {
          id: stored.id,
          name: stored.name,
          template: stored.template,
          currency: stored.currency,
          owner_id: stored.ownerId,
          archived: Number(stored.archived),
          password_hash: stored.passwordHash,
          password_version: stored.passwordVersion,
          revision: stored.revision,
        }
      : null
    const membership = book
      ? await db.getRepository(LedgerMemberEntity).findOne({
          select: { role: true },
          where: { ledgerId, userId: principal.user.id },
        })
      : null
    if (!book || !membership) {
      throw ErrorCode.LEDGER_NOT_FOUND()
    }
    const role = membership.role as LedgerRole
    if (rank[role] < required[capability]) {
      throw ErrorCode.FORBIDDEN('当前角色没有此操作权限')
    }
    if (book.archived && capability === 'write') {
      throw ErrorCode.LEDGER_ARCHIVED()
    }
    const unlocked = !book.password_hash || await db.getRepository(LedgerUnlockEntity).existsBy({
      ledgerId,
      sessionHash: principal.sessionHash,
      passwordVersion: book.password_version,
      expiresAt: Raw((column) => `${column} > UTC_TIMESTAMP(3)`),
      ...(capability === 'read' ? {} : { scope: 'write' }),
    })
    const locked = !unlocked
    if (locked && !allowLocked) {
      throw ErrorCode.LEDGER_LOCKED()
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
      throw ErrorCode.FORBIDDEN('记账成员只能修正自己创建的记录')
    }
  }
}
