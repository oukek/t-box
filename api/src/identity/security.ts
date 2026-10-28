import type { Actor } from '@t-box/app-server-sdk'
import type { AccountSession, RecoveryCodeStatus } from '@t-box/shared'
import type { IdentityService } from './service.js'
import { randomBytes } from 'node:crypto'
import { password } from '@t-box/server-foundation/auth'
import {
  digest,
  hashPassword,
  verifyPassword,
} from '@t-box/server-foundation/crypto'
import { object, text } from '@t-box/server-foundation/input'
import { sqlClock } from '@t-box/server-foundation/persistence/columns'
import {
  AppUserEntity,
  UserSessionEntity,
} from '@t-box/server-foundation/persistence/identity-entities'
import { isoTime } from '@t-box/server-foundation/time'
import { IsNull, Not, Raw } from 'typeorm'
import { UserRecoveryCodeEntity } from '../db/records/identity-entities.js'
import { ErrorCode } from '../error-codes.js'

export function deviceLabel(agent: unknown) {
  const value = typeof agent === 'string' ? agent.slice(0, 500) : ''
  const os = /Android/i.test(value)
    ? 'Android'
    : /iPad/i.test(value)
      ? 'iPad'
      : /iPhone|iPod/i.test(value)
        ? 'iPhone'
        : /Windows/i.test(value)
          ? 'Windows'
          : /Macintosh|Mac OS X/i.test(value)
            ? 'Mac'
            : /Linux/i.test(value)
              ? 'Linux'
              : '浏览器'
  const browser = /MicroMessenger/i.test(value)
    ? '微信'
    : /Edg\//i.test(value)
      ? 'Edge'
      : /Firefox\//i.test(value)
        ? 'Firefox'
        : /Chrome\/|CriOS\//i.test(value)
          ? 'Chrome'
          : /Safari\//i.test(value)
            ? 'Safari'
            : '应用'
  return `${os} · ${browser}`
}
export class AccountSecurityService {
  constructor(readonly identity: IdentityService) {}
  async sessions(actor: Actor): Promise<AccountSession[]> {
    await this.identity.authenticateHash(actor.sessionHash)
    const rows = await this.identity.source
      .getRepository(UserSessionEntity)
      .find({
        select: {
          sessionId: true,
          tokenHash: true,
          device: true,
          createdAt: true,
          lastSeenAt: true,
          expiresAt: true,
        },
        where: {
          userId: actor.user.id,
          expiresAt: Raw((column) => `${column} > UTC_TIMESTAMP(3)`),
        },
        order: { createdAt: 'DESC' },
        take: 100,
      })
      .then((rows) =>
        rows.map((row) => ({
          session_id: row.sessionId,
          token_hash: row.tokenHash,
          device: row.device,
          created_at: sqlClock(row.createdAt),
          last_seen_at:
            row.lastSeenAt === null ? null : sqlClock(row.lastSeenAt),
          expires_at: sqlClock(row.expiresAt),
        })),
      )
    return rows.map((row) => ({
      id: row.session_id,
      current: row.token_hash === actor.sessionHash,
      device: row.device,
      createdAt: isoTime(row.created_at),
      lastSeenAt: row.last_seen_at ? isoTime(row.last_seen_at) : null,
      expiresAt: isoTime(row.expires_at),
    }))
  }

  async revoke(actor: Actor, id: string) {
    await this.identity.authenticateHash(actor.sessionHash)
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) {
      throw ErrorCode.SESSION_ID_INVALID()
    }
    const row = await this.identity.source
      .getRepository(UserSessionEntity)
      .findOne({
        select: { tokenHash: true },
        where: { userId: actor.user.id, sessionId: id },
      })
      .then((row) => (row ? { token_hash: row.tokenHash } : null))
    if (!row) {
      throw ErrorCode.SESSION_NOT_FOUND()
    }
    await this.identity.source
      .getRepository(UserSessionEntity)
      .delete({ userId: actor.user.id, sessionId: id })
    return { current: row.token_hash === actor.sessionHash }
  }

  async revokeOthers(actor: Actor) {
    await this.identity.authenticateHash(actor.sessionHash)
    await this.identity.source
      .getRepository(UserSessionEntity)
      .delete({ userId: actor.user.id, tokenHash: Not(actor.sessionHash) })
  }

  async recoveryStatus(actor: Actor): Promise<RecoveryCodeStatus> {
    const [row] = await this.identity.source
      .createQueryBuilder()
      .select(
        'SUM(used_at IS NULL) AS remaining,MAX(created_at) AS generated_at',
      )
      .from('user_recovery_codes', 'user_recovery_codes')
      .where('user_id=:p0')
      .setParameters({ p0: actor.user.id })
      .getRawMany()
    return {
      remaining: Number(row.remaining || 0),
      generatedAt: row.generated_at ? isoTime(row.generated_at) : null,
    }
  }

  async generateRecoveryCodes(actor: Actor, value: unknown) {
    this.identity.limit(`recovery-generate:${actor.user.id}`, 10)
    const input = object(value, ['currentPassword'])
    const current = password(input.currentPassword)
    const codes = Array.from({ length: 8 }, () =>
      randomBytes(16).toString('hex').toUpperCase())
    await this.identity.source.transaction(async (db) => {
      await this.identity.authenticateHash(actor.sessionHash, db)
      const user = await db
        .getRepository(AppUserEntity)
        .findOne({
          select: { passwordHash: true },
          where: { id: actor.user.id },
          lock: { mode: 'pessimistic_write' },
        })
        .then((row) => (row ? { password_hash: row.passwordHash } : null))
      if (!user || !(await verifyPassword(current, user.password_hash))) {
        throw ErrorCode.CURRENT_PASSWORD_INVALID()
      }
      await db
        .getRepository(UserRecoveryCodeEntity)
        .delete({ user_id: actor.user.id })
      for (const code of codes) {
        await db
          .getRepository(UserRecoveryCodeEntity)
          .insert({ user_id: actor.user.id, code_hash: digest(code) })
      }
    })
    return { codes: codes.map((code) => code.match(/.{8}/g)!.join('-')) }
  }

  async resetPassword(value: unknown, ip: string) {
    this.identity.limit(`recovery-reset:${ip}`, 20)
    const input = object(value, ['username', 'recoveryCode', 'newPassword'])
    const username = text(input.username, '账号', 64)
    const nextPassword = password(input.newPassword)
    const code =
      typeof input.recoveryCode === 'string'
        ? input.recoveryCode
            .trim()
            .replaceAll('-', '')
            .replaceAll(' ', '')
            .toUpperCase()
        : ''
    const invalid = () => ErrorCode.RECOVERY_INVALID()
    if (!/^[a-f0-9]{32}$/i.test(code)) {
      throw invalid()
    }
    const codeHash = digest(code)
    const [candidate] = await this.identity.source
      .createQueryBuilder()
      .select('u.id', 'id')
      .from('app_users', 'u')
      .innerJoin('user_recovery_codes', 'c', 'c.user_id=u.id')
      .where(
        'u.username=:p0 AND u.enabled=TRUE AND c.code_hash=:p1 AND c.used_at IS NULL',
      )
      .setParameters({ p0: username, p1: codeHash })
      .getRawMany()
    if (!candidate) {
      throw invalid()
    }
    const hash = await hashPassword(nextPassword)
    await this.identity.source.transaction(async (db) => {
      const user = await db
        .getRepository(AppUserEntity)
        .findOne({
          select: { id: true, enabled: true },
          where: { id: candidate.id },
          lock: { mode: 'pessimistic_write' },
        })
        .then((row) => (row ? { id: row.id, enabled: row.enabled } : null))
      const match = await db.getRepository(UserRecoveryCodeEntity).findOne({
        select: { code_hash: true },
        where: {
          user_id: candidate.id,
          code_hash: codeHash,
          used_at: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      })
      if (!user?.enabled || !match) {
        throw invalid()
      }
      await db
        .getRepository(UserRecoveryCodeEntity)
        .update(
          { user_id: user.id, code_hash: codeHash },
          { used_at: () => 'UTC_TIMESTAMP(3)' },
        )
      await db
        .getRepository(AppUserEntity)
        .update(
          { id: user.id },
          { passwordHash: hash, failedAttempts: 0, lockedUntil: null },
        )
      await db.getRepository(UserSessionEntity).delete({ userId: user.id })
    })
  }
}
