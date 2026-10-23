import type { IdentityService } from './service.js'
import { randomBytes, randomUUID } from 'node:crypto'
import { UserSessionEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { digest } from '../admin/crypto.js'
import { ErrorCode } from '../error-codes.js'

export const nativeTokenPattern = /^n1_[a-f0-9]{64}_[a-f0-9]{64}$/

/** Native credentials can only use the action gateway, and die with their parent login session. */
export class NativeActionSessions {
  constructor(private readonly identity: IdentityService) {}
  async issue(token: string, value: unknown) {
    const actor = await this.identity.authenticate(token)
    const input = (value ?? {}) as { previousToken?: unknown }
    if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'previousToken') || (input.previousToken !== undefined && (typeof input.previousToken !== 'string' || !nativeTokenPattern.test(input.previousToken)))) {
      throw ErrorCode.NATIVE_ACTION_INVALID()
    }
    const credential = `n1_${actor.sessionHash}_${randomBytes(32).toString('hex')}`
    const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString()
    await this.identity.source.transaction(async (db) => {
      await this.identity.authenticateHash(actor.sessionHash, db)
      if (typeof input.previousToken === 'string') {
        await db.getRepository(UserSessionEntity).delete({ tokenHash: digest(input.previousToken), userId: actor.user.id })
      }
      await db.getRepository(UserSessionEntity).insert({ tokenHash: digest(credential), userId: actor.user.id, device: 'T方舟 快捷指令', sessionId: randomUUID(), expiresAt, lastSeenAt: new Date().toISOString() })
    })
    return { token: credential, expiresAt, subject: actor.user.id }
  }

  async authenticate(token: string) {
    if (!nativeTokenPattern.test(token)) {
      throw ErrorCode.UNAUTHENTICATED('原生快捷指令会话已过期，请打开应用更新登录状态')
    }
    const actor = await this.identity.authenticateHash(digest(token))
    const parent = await this.identity.authenticateHash(token.split('_')[1]!)
    if (parent.user.id !== actor.user.id) {
      throw ErrorCode.UNAUTHENTICATED()
    }
    return actor
  }

  async revoke(token: string) {
    if (!nativeTokenPattern.test(token)) {
      throw ErrorCode.UNAUTHENTICATED()
    }
    await this.identity.source.getRepository(UserSessionEntity).delete({ tokenHash: digest(token) })
  }
}
