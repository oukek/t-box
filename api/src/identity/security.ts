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
import { ApiError } from '@t-box/server-foundation/errors'
import { object, text } from '@t-box/server-foundation/input'
import { isoTime } from '@t-box/server-foundation/time'

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
  const browser = /Edg\//i.test(value)
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
    const rows = await this.identity.source.query(
      'SELECT session_id,token_hash,device,created_at,last_seen_at,expires_at FROM user_sessions WHERE user_id=? AND expires_at>UTC_TIMESTAMP(3) ORDER BY created_at DESC LIMIT 100',
      [actor.user.id],
    )
    return rows.map((row: any) => ({
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
      throw new ApiError(400, 'SESSION_ID_INVALID', '登录设备标识无效')
    }
    const [row] = await this.identity.source.query(
      'SELECT token_hash FROM user_sessions WHERE user_id=? AND session_id=?',
      [actor.user.id, id],
    )
    if (!row) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', '设备登录已失效或不存在')
    }
    await this.identity.source.query(
      'DELETE FROM user_sessions WHERE user_id=? AND session_id=?',
      [actor.user.id, id],
    )
    return { current: row.token_hash === actor.sessionHash }
  }

  async revokeOthers(actor: Actor) {
    await this.identity.authenticateHash(actor.sessionHash)
    await this.identity.source.query(
      'DELETE FROM user_sessions WHERE user_id=? AND token_hash<>?',
      [actor.user.id, actor.sessionHash],
    )
  }

  async recoveryStatus(actor: Actor): Promise<RecoveryCodeStatus> {
    const [row] = await this.identity.source.query(
      'SELECT SUM(used_at IS NULL) AS remaining,MAX(created_at) AS generated_at FROM user_recovery_codes WHERE user_id=?',
      [actor.user.id],
    )
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
      const [user] = await db.query(
        'SELECT password_hash FROM app_users WHERE id=? FOR UPDATE',
        [actor.user.id],
      )
      if (!(await verifyPassword(current, user.password_hash))) {
        throw new ApiError(400, 'CURRENT_PASSWORD_INVALID', '当前密码不正确')
      }
      await db.query('DELETE FROM user_recovery_codes WHERE user_id=?', [
        actor.user.id,
      ])
      for (const code of codes) {
        await db.query(
          'INSERT INTO user_recovery_codes(user_id,code_hash) VALUES(?,?)',
          [actor.user.id, digest(code)],
        )
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
    const invalid = () =>
      new ApiError(
        400,
        'RECOVERY_INVALID',
        '账号或恢复码无效，恢复码可能已使用或已被更新',
      )
    if (!/^[a-f0-9]{32}$/i.test(code)) {
      throw invalid()
    }
    const codeHash = digest(code)
    const [candidate] = await this.identity.source.query(
      'SELECT u.id FROM app_users u JOIN user_recovery_codes c ON c.user_id=u.id WHERE u.username=? AND u.enabled=TRUE AND c.code_hash=? AND c.used_at IS NULL',
      [username, codeHash],
    )
    if (!candidate) {
      throw invalid()
    }
    const hash = await hashPassword(nextPassword)
    await this.identity.source.transaction(async (db) => {
      const [user] = await db.query(
        'SELECT id,enabled FROM app_users WHERE id=? FOR UPDATE',
        [candidate.id],
      )
      const [match] = await db.query(
        'SELECT code_hash FROM user_recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL FOR UPDATE',
        [candidate.id, codeHash],
      )
      if (!user?.enabled || !match) {
        throw invalid()
      }
      await db.query(
        'UPDATE user_recovery_codes SET used_at=UTC_TIMESTAMP(3) WHERE user_id=? AND code_hash=?',
        [user.id, codeHash],
      )
      await db.query(
        'UPDATE app_users SET password_hash=?,failed_attempts=0,locked_until=NULL WHERE id=?',
        [hash, user.id],
      )
      await db.query('DELETE FROM user_sessions WHERE user_id=?', [user.id])
    })
  }
}
