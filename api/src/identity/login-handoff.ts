import type { DataSource } from 'typeorm'
import type { IdentityService } from './service.js'
import { randomUUID } from 'node:crypto'
import { object } from '@t-box/server-foundation/input'
import { EntitySchema, LessThan } from 'typeorm'
import { digest } from '../admin/crypto.js'
import { ErrorCode } from '../error-codes.js'
import { sessionDevice } from './session-policy.js'

interface HandoffRow {
  id: string
  secretHash: string
  target: 'browser' | 'collector'
  sourceHash: string | null
  userId: string | null
  consumed: boolean
  expiresAt: Date
}
export const LoginHandoff = new EntitySchema<HandoffRow>({
  name: 'LoginHandoff',
  tableName: 'login_handoffs',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    secretHash: { type: 'char', length: 64, name: 'secret_hash', select: false },
    target: { type: 'varchar', length: 16 },
    sourceHash: { type: 'char', length: 64, name: 'source_hash', nullable: true, select: false },
    userId: { type: 'char', length: 36, name: 'user_id', nullable: true },
    consumed: { type: Boolean, default: false },
    expiresAt: { type: 'datetime', precision: 3, name: 'expires_at' },
  },
})
export const loginHandoffExtension = {
  id: '2026-11-26-login-handoffs',
  tables: [`CREATE TABLE login_handoffs (
    id char(36) NOT NULL PRIMARY KEY,
    secret_hash char(64) NOT NULL,
    target varchar(16) NOT NULL,
    source_hash char(64) DEFAULT NULL,
    user_id char(36) DEFAULT NULL,
    consumed tinyint(1) NOT NULL DEFAULT 0,
    expires_at datetime(3) NOT NULL,
    KEY login_handoff_expiry(expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
}
function proof(input: Record<string, unknown>) {
  if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id) || typeof input.secret !== 'string' || !/^[a-f0-9]{64}$/.test(input.secret)) {
    throw ErrorCode.INVALID_ARGUMENTS('快捷登录凭据无效')
  }
  return { id: input.id, secretHash: digest(input.secret) }
}
export class LoginHandoffService {
  constructor(private readonly source: DataSource, private readonly identity: IdentityService) {}

  async start(value: unknown, ip: string) {
    this.identity.limit(`login-handoff:${ip}`, 40)
    const input = object(value, ['secret', 'target'])
    if (typeof input.secret !== 'string' || !/^[a-f0-9]{64}$/.test(input.secret) || (input.target !== 'browser' && input.target !== 'collector')) {
      throw ErrorCode.INVALID_ARGUMENTS('快捷登录参数无效')
    }
    const id = randomUUID()
    const expiresAt = new Date(Date.now() + 120_000)
    const repository = this.source.getRepository(LoginHandoff)
    await repository.delete({ expiresAt: LessThan(new Date()) })
    await repository.insert({ id, secretHash: digest(input.secret), target: input.target, expiresAt })
    return { id, expiresAt: expiresAt.toISOString(), target: input.target }
  }

  async approve(value: unknown, token: string) {
    const input = object(value, ['id', 'secret', 'userId', 'target'])
    await this.source.transaction(async (db) => {
      const row = await db.getRepository(LoginHandoff).findOne({ where: proof(input), lock: { mode: 'pessimistic_write' } })
      if (!row || row.consumed || row.userId || row.expiresAt.getTime() <= Date.now() || row.target !== input.target) {
        throw ErrorCode.INVALID_ARGUMENTS('快捷登录已失效，请重试')
      }
      const actor = await this.identity.authenticate(token, db)
      if (actor.user.id !== input.userId) {
        throw ErrorCode.UNAUTHENTICATED('Mac 版账号已变化，请重新识别')
      }
      await db.getRepository(LoginHandoff).update({ id: row.id }, { userId: actor.user.id, sourceHash: actor.sessionHash })
    })
  }

  async redeem(value: unknown, client?: unknown) {
    const input = object(value, ['id', 'secret', 'userId', 'target'])
    return this.source.transaction(async (db) => {
      const repository = db.getRepository(LoginHandoff)
      const row = await repository.findOne({ where: proof(input), select: { id: true, target: true, userId: true, sourceHash: true, consumed: true, expiresAt: true }, lock: { mode: 'pessimistic_write' } })
      if (!row || row.consumed || !row.sourceHash || row.expiresAt.getTime() <= Date.now() || row.userId !== input.userId || row.target !== input.target) {
        throw ErrorCode.UNAUTHENTICATED('快捷登录已失效，请重新识别 Mac 版账号')
      }
      // Revoking the Mac session between approval and redemption invalidates the handoff too.
      const actor = await this.identity.authenticateHash(row.sourceHash, db)
      if (actor.user.id !== row.userId) {
        throw ErrorCode.UNAUTHENTICATED()
      }
      const session = await this.identity.session(db, actor.user, row.target === 'collector' ? 'T方舟采集插件 · Mac 快捷登录' : sessionDevice('浏览器 · Mac 快捷登录', client))
      await repository.update({ id: row.id }, { consumed: true, sourceHash: null })
      return session
    })
  }
}
