import type { FastifyRequest } from 'fastify'
import type { AdminStore } from './store.js'
import { randomBytes } from 'node:crypto'
import { Raw } from 'typeorm'
import { AdminSessionEntity, AdminUserEntity } from '../db/entities.js'
import { ErrorCode } from '../error-codes.js'
import { digest, hashPassword, verifyPassword } from './crypto.js'
import { bad, body, password, text } from './validation.js'

const unauthorized = () => ErrorCode.UNAUTHENTICATED('请登录后台管理')
export function sessionToken(request: FastifyRequest) {
  return (
    request.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('tbox_admin='))
      ?.slice(11) ?? ''
  )
}
export const cookie = (token: string, age = 28800) =>
  `tbox_admin=${token}; Path=/api/v1/admin; HttpOnly; SameSite=Strict; Max-Age=${age}${
    process.env.NODE_ENV === 'production' ? '; Secure' : ''
  }`
export class AdminAuth {
  private readonly attempts = new Map<
    string,
    { count: number, expires: number }
  >()

  private readonly dummy = hashPassword(randomBytes(32).toString('hex'))
  constructor(readonly store: AdminStore) {}
  async login(value: unknown, ip: string) {
    const input = body(value, ['username', 'password'])
    const username = text(input.username, '账号', 64)
    if (
      typeof input.password !== 'string' ||
      !input.password ||
      input.password.length > 128
    ) {
      bad('密码格式无效')
    }
    const secret = input.password
    const now = Date.now()
    for (const [key, entry] of this.attempts) {
      if (entry.expires < now) {
        this.attempts.delete(key)
      }
    }
    const key = digest(ip)
    const entry = this.attempts.get(key) ?? {
      count: 0,
      expires: now + 15 * 60_000,
    }
    if (++entry.count > 20 || this.attempts.size > 5000) {
      throw ErrorCode.LOGIN_LIMIT()
    }
    this.attempts.set(key, entry)
    const result = await this.store.transaction(async (db) => {
      const [user] = await db
        .queryBuilder()
        .select(
          'id,password_hash,enabled,(locked_until > UTC_TIMESTAMP(3)) AS locked',
        )
        .from('admin_users', 'admin_users')
        .where('username=:p0')
        .setLock('pessimistic_write')
        .setParameters({ p0: username })
        .getRawMany<{
        id: string
        password_hash: string
        enabled: number
        locked: number
      }>()
      const valid = await verifyPassword(
        secret,
        user?.password_hash ?? (await this.dummy),
      )
      if (!user || !valid || !user.enabled || user.locked) {
        if (user && !user.locked) {
          await db.repository(AdminUserEntity).update(
            { id: user.id },
            {
              failedAttempts: () => 'failed_attempts+1',
              lockedUntil: () =>
                'IF(failed_attempts>=5,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE),NULL)',
            },
          )
        }
        return null
      }
      await db
        .repository(AdminUserEntity)
        .update({ id: user.id }, { failedAttempts: 0, lockedUntil: null })
      const token = randomBytes(32).toString('hex')
      await db.repository(AdminSessionEntity).insert({
        tokenHash: digest(token),
        adminId: user.id,
        expiresAt: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 8 HOUR)',
      })
      return { token, user: { id: user.id, username } }
    })
    if (!result) {
      throw ErrorCode.LOGIN_FAILED()
    }
    await this.store
      .repository(AdminSessionEntity)
      .delete({ expiresAt: Raw((column) => `${column} < UTC_TIMESTAMP(3)`) })
    return result
  }

  async authenticate(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw unauthorized()
    }
    const [user] = await this.store
      .queryBuilder()
      .select('u.id,u.username')
      .from('admin_sessions', 's')
      .innerJoin('admin_users', 'u', 'u.id=s.admin_id')
      .where(
        's.token_hash=:p0 AND s.expires_at>UTC_TIMESTAMP(3) AND u.enabled=TRUE',
      )
      .setParameters({ p0: digest(token) })
      .getRawMany<{ id: string, username: string }>()
    if (!user) {
      throw unauthorized()
    }
    return user
  }

  async logout(token: string) {
    await this.store
      .repository(AdminSessionEntity)
      .delete({ tokenHash: digest(token) })
  }

  async setUserEnabled(id: string, active: boolean) {
    await this.store.transaction(async (db) => {
      // Consistent locking prevents concurrent changes from disabling every admin.
      const users = await db
        .repository(AdminUserEntity)
        .find({
          select: { id: true, enabled: true },
          order: { id: 'ASC' },
          lock: { mode: 'pessimistic_write' },
        })
        .then((rows) =>
          rows.map((row) => ({ id: row.id, enabled: row.enabled })),
        )
      if (!users.some((user) => user.id === id)) {
        throw ErrorCode.ADMIN_NOT_FOUND()
      }
      if (!active && !users.some((user) => user.id !== id && user.enabled)) {
        bad('至少保留一个启用的管理员')
      }
      await db.repository(AdminUserEntity).update({ id }, { enabled: active })
      if (!active) {
        await db.repository(AdminSessionEntity).delete({ adminId: id })
      }
    })
  }

  async changePassword(id: string, value: unknown) {
    const input = body(value, ['currentPassword', 'newPassword'])
    const newHash = await hashPassword(password(input.newPassword))
    await this.store.transaction(async (db) => {
      const user = await db
        .repository(AdminUserEntity)
        .findOne({
          select: { passwordHash: true },
          where: { id },
          lock: { mode: 'pessimistic_write' },
        })
        .then((row) => (row ? { password_hash: row.passwordHash } : null))
      if (
        !user ||
        typeof input.currentPassword !== 'string' ||
        input.currentPassword.length > 128 ||
        !(await verifyPassword(input.currentPassword, user.password_hash))
      ) {
        bad('当前密码不正确')
      }
      await db
        .repository(AdminUserEntity)
        .update(
          { id },
          { passwordHash: newHash, failedAttempts: 0, lockedUntil: null },
        )
      await db.repository(AdminSessionEntity).delete({ adminId: id })
    })
  }
}
