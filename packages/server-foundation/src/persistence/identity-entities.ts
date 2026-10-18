import type {
  EntitySchemaColumnOptions,
  EntitySchemaOptions,
  ObjectLiteral,
} from 'typeorm'
import { EntitySchema } from 'typeorm'

const id: EntitySchemaColumnOptions = {
  type: 'char',
  length: 36,
  primary: true,
}
const reference: EntitySchemaColumnOptions = { type: 'char', length: 36 }
const created: EntitySchemaColumnOptions = {
  type: 'datetime',
  precision: 3,
  default: () => '(UTC_TIMESTAMP(3))',
}
const secret: EntitySchemaColumnOptions = {
  type: 'varchar',
  length: 200,
  select: false,
}
const table = <T extends ObjectLiteral>(
  name: string,
  tableName: string,
  columns: EntitySchemaOptions<T>['columns'],
) => new EntitySchema<T>({ name, tableName, columns })
/** Explicit metadata mirrors the initialization schema. No automatic synchronization. */
export interface StoredAppUser {
  id: string
  username: string
  nickname: string
  passwordHash: string
  enabled: boolean
  failedAttempts: number
  lockedUntil: Date | string | null
  createdAt: Date | string
}

export interface StoredUserSession {
  tokenHash: string
  userId: string
  expiresAt: Date | string
  sessionId: string
  device: string
  createdAt: Date | string
  lastSeenAt: Date | string | null
}

export const AppUserEntity = table<StoredAppUser>('AppUser', 'app_users', {
  id,
  username: { type: 'varchar', length: 64, unique: true },
  nickname: { type: 'varchar', length: 40 },
  passwordHash: { ...secret, name: 'password_hash' },
  enabled: { type: Boolean, default: true },
  failedAttempts: { type: Number, name: 'failed_attempts', default: 0 },
  lockedUntil: {
    type: 'datetime',
    precision: 3,
    name: 'locked_until',
    nullable: true,
  },
  createdAt: { ...created, name: 'created_at' },
})

export const UserSessionEntity = table<StoredUserSession>(
  'UserSession',
  'user_sessions',
  {
    sessionId: {
      type: 'char',
      length: 36,
      name: 'session_id',
      default: () => '(UUID())',
    },
    device: { type: 'varchar', length: 120, default: '未知设备' },
    createdAt: { ...created, name: 'created_at' },
    lastSeenAt: {
      ...created,
      name: 'last_seen_at',
      default: undefined,
      nullable: true,
    },
    tokenHash: {
      type: 'char',
      length: 64,
      name: 'token_hash',
      primary: true,
      select: false,
    },
    userId: { ...reference, name: 'user_id' },
    expiresAt: { type: 'datetime', precision: 3, name: 'expires_at' },
  },
)

export const platformEntities = [AppUserEntity, UserSessionEntity]
