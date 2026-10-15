import type { Actor as Principal } from '@t-box/app-server-sdk'
import type { AppUser, UserSession } from '@t-box/shared'
import type { DataSource, EntityManager } from 'typeorm'
import { randomBytes, randomUUID } from 'node:crypto'
import { ApiError, invalid } from '@t-box/server-foundation/errors'
import { object, text } from '@t-box/server-foundation/input'
import { isoTime } from '@t-box/server-foundation/time'
import { digest, hashPassword, verifyPassword } from '../admin/crypto.js'
import { password } from '../admin/validation.js'

export class IdentityService {
  private readonly touched = new Map<string, number>()
  private readonly attempts = new Map<
    string,
    { count: number, expires: number }
  >()

  private readonly dummy = hashPassword(randomBytes(32).toString('hex'))
  constructor(
    readonly source: DataSource,
    private readonly onRegistered?: (db: EntityManager, userId: string) => Promise<unknown>,
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
      throw new ApiError(429, 'RATE_LIMIT', '尝试次数过多，请稍后重试')
    }
    this.attempts.set(key, entry)
  }

  private async session(
    db: EntityManager,
    user: AppUser,
    device = '未知设备',
  ): Promise<UserSession> {
    const token = randomBytes(32).toString('hex')
    await db.query(
      'INSERT INTO user_sessions(token_hash,user_id,expires_at,device,last_seen_at,session_id) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY),?,UTC_TIMESTAMP(3),?)',
      [digest(token), user.id, device, randomUUID()],
    )
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
      await db.query(
        'INSERT INTO app_users(id,username,nickname,password_hash) VALUES(?,?,?,?)',
        [user.id, username, nickname, hash],
      )
      await this.onRegistered?.(db, user.id)
      const [row] = await db.query(
        'SELECT created_at AS createdAt FROM app_users WHERE id=?',
        [user.id],
      )
      return this.session(db, { ...user, createdAt: isoTime(row.createdAt) }, device)
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
      const [row] = await db.query(
        'SELECT id,username,nickname,created_at AS createdAt,password_hash,enabled,(locked_until>UTC_TIMESTAMP(3)) AS locked FROM app_users WHERE username=? FOR UPDATE',
        [username],
      )
      const valid = await verifyPassword(
        secret,
        row?.password_hash ?? (await this.dummy),
      )
      if (!row || !row.enabled || Number(row.locked) || !valid) {
        if (row && !Number(row.locked)) {
          await db.query(
            'UPDATE app_users SET failed_attempts=failed_attempts+1,locked_until=IF(failed_attempts>=5,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE),NULL) WHERE id=?',
            [row.id],
          )
        }
        return null
      }
      await db.query(
        'UPDATE app_users SET failed_attempts=0,locked_until=NULL WHERE id=?',
        [row.id],
      )
      return this.session(db, {
        id: row.id,
        username: row.username,
        nickname: row.nickname,
        createdAt: isoTime(row.createdAt),
      }, device)
    })
    if (!result) {
      throw new ApiError(
        401,
        'LOGIN_FAILED',
        '账号或密码不正确，或账号已被锁定',
      )
    }
    await this.source.query(
      'DELETE FROM user_sessions WHERE expires_at<UTC_TIMESTAMP(3)',
    )
    return result
  }

  async authenticate(
    token: string,
    db = this.source.manager,
  ): Promise<Principal> {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw new ApiError(401, 'UNAUTHENTICATED', '请登录 T Box')
    }
    return this.authenticateHash(digest(token), db)
  }

  async authenticateHash(
    sessionHash: string,
    db = this.source.manager,
  ): Promise<Principal> {
    const [user] = await db.query(
      'SELECT u.id,u.username,u.nickname,u.created_at AS createdAt FROM user_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.enabled=TRUE',
      [sessionHash],
    )
    if (!user) {
      throw new ApiError(401, 'UNAUTHENTICATED', '登录已失效，请重新登录')
    }
    const now = Date.now()
    if (now - (this.touched.get(sessionHash) || 0) > 300000) {
      if (this.touched.size >= 5000) {
        this.touched.delete(this.touched.keys().next().value!)
      }
      this.touched.set(sessionHash, now)
      await db.query('UPDATE user_sessions SET last_seen_at=UTC_TIMESTAMP(3) WHERE token_hash=? AND (last_seen_at IS NULL OR last_seen_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE))', [sessionHash])
    }
    return {
      user: { ...user, createdAt: isoTime(user.createdAt) },
      sessionHash,
    }
  }

  async logout(principal: Principal) {
    await this.source.query('DELETE FROM user_sessions WHERE token_hash=?', [
      principal.sessionHash,
    ])
  }

  async updateProfile(principal: Principal, value: unknown): Promise<AppUser> {
    const input = object(value, ['nickname'])
    const nickname = text(input.nickname, '昵称', 40)
    return this.source.transaction(async (db) => {
      const current = await this.authenticateHash(principal.sessionHash, db)
      await db.query('UPDATE app_users SET nickname=? WHERE id=?', [
        nickname,
        current.user.id,
      ])
      return { ...current.user, nickname }
    })
  }

  async changePassword(principal: Principal, value: unknown) {
    const input = object(value, ['currentPassword', 'newPassword'])
    const next = await hashPassword(password(input.newPassword))
    await this.source.transaction(async (db) => {
      await this.authenticateHash(principal.sessionHash, db)
      const [user] = await db.query(
        'SELECT password_hash FROM app_users WHERE id=? FOR UPDATE',
        [principal.user.id],
      )
      if (
        typeof input.currentPassword !== 'string' ||
        input.currentPassword.length > 128 ||
        !(await verifyPassword(input.currentPassword, user.password_hash))
      ) {
        invalid('currentPassword', '当前密码不正确')
      }
      await db.query(
        'UPDATE app_users SET password_hash=?,failed_attempts=0,locked_until=NULL WHERE id=?',
        [next, principal.user.id],
      )
      await db.query('DELETE FROM user_sessions WHERE user_id=?', [
        principal.user.id,
      ])
    })
  }
}
export function bearer(value: string | undefined) {
  return value?.startsWith('Bearer ') ? value.slice(7) : ''
}
