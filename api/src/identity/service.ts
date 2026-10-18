import type { Actor as Principal } from '@t-box/app-server-sdk'
import type { AppUser, UserSession } from '@t-box/shared'
import type { DataSource, EntityManager } from 'typeorm'
import { randomBytes, randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { object, text } from '@t-box/server-foundation/input'
import { sqlClock } from '@t-box/server-foundation/persistence/columns'
import {
  AppUserEntity,
  UserSessionEntity,
} from '@t-box/server-foundation/persistence/identity-entities'
import { isoTime } from '@t-box/server-foundation/time'
import { Raw } from 'typeorm'
import { digest, hashPassword, verifyPassword } from '../admin/crypto.js'
import { password } from '../admin/validation.js'
import { ErrorCode } from '../error-codes.js'

export class IdentityService {
  private readonly touched = new Map<string, number>()
  private readonly attempts = new Map<
    string,
    { count: number, expires: number }
  >()

  private readonly dummy = hashPassword(randomBytes(32).toString('hex'))
  constructor(
    readonly source: DataSource,
    private readonly onRegistered?: (
      db: EntityManager,
      userId: string,
    ) => Promise<unknown>,
  ) {}

  limit(key: string, max = 20, ttl = 15 * 60_000) {
    const now = Date.now()
    for (const [id, entry] of this.attempts) {
      if (entry.expires <= now) {
        this.attempts.delete(id)
      }
    }
    const entry = this.attempts.get(key) ?? { count: 0, expires: now + ttl }
    if (++entry.count > max || this.attempts.size > 5000) {
      throw ErrorCode.RATE_LIMIT()
    }
    this.attempts.set(key, entry)
  }

  private async session(
    db: EntityManager,
    user: AppUser,
    device = '未知设备',
  ): Promise<UserSession> {
    const token = randomBytes(32).toString('hex')
    await db.getRepository(UserSessionEntity).insert({
      tokenHash: digest(token),
      userId: user.id,
      expiresAt: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY)',
      device,
      lastSeenAt: () => 'UTC_TIMESTAMP(3)',
      sessionId: randomUUID(),
    })
    return { token, user }
  }

  async register(value: unknown, ip: string, device?: string) {
    this.limit(`signup:${ip}`, 10, 24 * 60 * 60_000)
    const input = object(value, ['username', 'password', 'nickname'])
    const username = text(input.username, '账号', 64)
    if (!/^[\w.-]{3,64}$/.test(username)) {
      invalid('username', '账号须为 3–64 位字母、数字或 _ . -')
    }
    const nickname =
      input.nickname === undefined
        ? username.slice(0, 40)
        : text(input.nickname, '昵称', 40)
    const hash = await hashPassword(password(input.password))
    return this.source.transaction(async (db) => {
      const user = { id: randomUUID(), username, nickname }
      await db.getRepository(AppUserEntity).insert({
        id: user.id,
        username,
        nickname,
        passwordHash: hash,
      })
      await this.onRegistered?.(db, user.id)
      const row = await db
        .getRepository(AppUserEntity)
        .findOne({ select: { createdAt: true }, where: { id: user.id } })
        .then((row) => (row ? { createdAt: sqlClock(row.createdAt) } : null))
      if (!row) {
        throw ErrorCode.SCHEMA_REQUIRED()
      }
      return this.session(
        db,
        { ...user, createdAt: isoTime(row.createdAt) },
        device,
      )
    })
  }

  async login(value: unknown, ip: string, device?: string) {
    this.limit(`login:${ip}`)
    const input = object(value, ['username', 'password'])
    const username = text(input.username, '账号', 64)
    if (
      typeof input.password !== 'string' ||
      !input.password ||
      input.password.length > 128
    ) {
      invalid('password', '密码格式无效')
    }
    const secret = input.password
    const result = await this.source.transaction(async (db) => {
      const [row] = await db
        .createQueryBuilder()
        .select(
          'id,username,nickname,created_at AS createdAt,password_hash,enabled,(locked_until>UTC_TIMESTAMP(3)) AS locked',
        )
        .from('app_users', 'app_users')
        .where('username=:p0')
        .setLock('pessimistic_write')
        .setParameters({ p0: username })
        .getRawMany()
      const valid = await verifyPassword(
        secret,
        row?.password_hash ?? (await this.dummy),
      )
      if (!row || !row.enabled || Number(row.locked) || !valid) {
        if (row && !Number(row.locked)) {
          await db.getRepository(AppUserEntity).update(
            { id: row.id },
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
        .getRepository(AppUserEntity)
        .update({ id: row.id }, { failedAttempts: 0, lockedUntil: null })
      if (!row) {
        throw ErrorCode.SCHEMA_REQUIRED()
      }
      return this.session(
        db,
        {
          id: row.id,
          username: row.username,
          nickname: row.nickname,
          createdAt: isoTime(row.createdAt),
        },
        device,
      )
    })
    if (!result) {
      throw ErrorCode.LOGIN_FAILED()
    }
    await this.source
      .getRepository(UserSessionEntity)
      .delete({ expiresAt: Raw((column) => `${column} < UTC_TIMESTAMP(3)`) })
    return result
  }

  async authenticate(
    token: string,
    db = this.source.manager,
  ): Promise<Principal> {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw ErrorCode.UNAUTHENTICATED('请登录 T Box')
    }
    return this.authenticateHash(digest(token), db)
  }

  async authenticateHash(
    sessionHash: string,
    db = this.source.manager,
  ): Promise<Principal> {
    const [user] = await db
      .createQueryBuilder()
      .select('u.id,u.username,u.nickname,u.created_at AS createdAt')
      .from('user_sessions', 's')
      .innerJoin('app_users', 'u', 'u.id=s.user_id')
      .where(
        's.token_hash=:p0 AND s.expires_at>UTC_TIMESTAMP(3) AND u.enabled=TRUE',
      )
      .setParameters({ p0: sessionHash })
      .getRawMany()
    if (!user) {
      throw ErrorCode.UNAUTHENTICATED('登录已失效，请重新登录')
    }
    const now = Date.now()
    if (now - (this.touched.get(sessionHash) || 0) > 300000) {
      if (this.touched.size >= 5000) {
        this.touched.delete(this.touched.keys().next().value!)
      }
      this.touched.set(sessionHash, now)
      await db
        .createQueryBuilder()
        .update('user_sessions')
        .set({ lastSeenAt: () => 'UTC_TIMESTAMP(3)' })
        .updateEntity(false)
        .where(
          'token_hash=:p0 AND (last_seen_at IS NULL OR last_seen_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE))',
        )
        .setParameters({ p0: sessionHash })
        .execute()
    }
    return {
      user: { ...user, createdAt: isoTime(user.createdAt) },
      sessionHash,
    }
  }

  async logout(principal: Principal) {
    await this.source
      .getRepository(UserSessionEntity)
      .delete({ tokenHash: principal.sessionHash })
  }

  async updateProfile(principal: Principal, value: unknown): Promise<AppUser> {
    const input = object(value, ['nickname'])
    const nickname = text(input.nickname, '昵称', 40)
    return this.source.transaction(async (db) => {
      const current = await this.authenticateHash(principal.sessionHash, db)
      await db
        .getRepository(AppUserEntity)
        .update({ id: current.user.id }, { nickname })
      return { ...current.user, nickname }
    })
  }

  async changePassword(principal: Principal, value: unknown) {
    const input = object(value, ['currentPassword', 'newPassword'])
    const next = await hashPassword(password(input.newPassword))
    await this.source.transaction(async (db) => {
      await this.authenticateHash(principal.sessionHash, db)
      const user = await db
        .getRepository(AppUserEntity)
        .findOne({
          select: { passwordHash: true },
          where: { id: principal.user.id },
          lock: { mode: 'pessimistic_write' },
        })
        .then((row) => (row ? { password_hash: row.passwordHash } : null))
      if (
        !user ||
        typeof input.currentPassword !== 'string' ||
        input.currentPassword.length > 128 ||
        !(await verifyPassword(input.currentPassword, user.password_hash))
      ) {
        invalid('currentPassword', '当前密码不正确')
      }
      await db
        .getRepository(AppUserEntity)
        .update(
          { id: principal.user.id },
          { passwordHash: next, failedAttempts: 0, lockedUntil: null },
        )
      await db
        .getRepository(UserSessionEntity)
        .delete({ userId: principal.user.id })
    })
  }
}
export function bearer(value: string | undefined) {
  return value?.startsWith('Bearer ') ? value.slice(7) : ''
}
