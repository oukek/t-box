import type { DataSource } from 'typeorm'
import { randomBytes, randomUUID } from 'node:crypto'
import { validId } from '@t-box/app-contracts'
import { AdminUserEntity } from '../db/entities.js'
import { ApplicationImportCredentialEntity } from '../db/records/applications-entities.js'
import { ErrorCode } from '../error-codes.js'
import { bundleHash } from './build-import.js'

export async function createImportCredential(
  source: DataSource,
  username: string,
  apps: string[],
  days: number,
) {
  if (
    !apps.length ||
    apps.length > 100 ||
    !apps.every(validId) ||
    !Number.isSafeInteger(days) ||
    days < 1 ||
    days > 365
  ) {
    throw ErrorCode.INTERNAL_PROVIDE_EXPLICIT_APP_IDS_AND_EXPIRY_FROM_1_TO_365_DAYS()
  }
  const admin = await source
    .getRepository(AdminUserEntity)
    .findOne({
      select: { id: true },
      where: { username, enabled: true },
    })
    .then((row) => (row ? { id: row.id } : null))
  if (!admin) {
    throw ErrorCode.INTERNAL_ENABLED_ADMINISTRATOR_NOT_FOUND()
  }
  const id = randomUUID()
  const token = 'tbox_build_' + randomBytes(32).toString('base64url')
  await source
    .createQueryBuilder()
    .insert()
    .into('application_import_credentials')
    .values({
      id,
      token_hash: bundleHash(token),
      administrator_id: admin.id,
      apps: () => ':p3',
      expires_at: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL :p4 DAY)',
    })
    .updateEntity(false)
    .setParameters({ p3: JSON.stringify([...new Set(apps)]), p4: days })
    .execute()
  return { id, token }
}

/** Deployment receives only the SHA-256 digest; the raw GitHub Secret never reaches the server. */
export async function synchronizeImportCredential(
  source: DataSource,
  tokenHash: string,
  apps: string[],
) {
  if (
    !/^[a-f0-9]{64}$/.test(tokenHash) ||
    !apps.length ||
    apps.length > 100 ||
    !apps.every(validId)
  ) {
    throw ErrorCode.INTERNAL_INVALID_DEPLOYMENT_IMPORT_CREDENTIAL_DIGEST_OR_APPLICATION_SCOPE()
  }
  const db = source.createQueryRunner()
  await db.connect()
  let locked = false
  try {
    // native-sql: MySQL advisory lock must use this exact connection
    const [lock] = await db.query(
      'SELECT GET_LOCK(\'tbox_github_import_credential\',30) AS acquired',
    )
    if (Number(lock?.acquired) !== 1) {
      throw ErrorCode.INTERNAL_UNABLE_TO_LOCK_MANAGED_IMPORT_CREDENTIAL_SYNCHRONIZATION()
    }
    locked = true
    await db.startTransaction()
    const current = await db.manager
      .getRepository(ApplicationImportCredentialEntity)
      .findOne({
        select: {
          id: true,
          token_hash: true,
          administrator_id: true,
          revoked_at: true,
        },
        where: { managed_key: 'github-actions' },
        lock: { mode: 'pessimistic_write' },
      })
    const [admin] = await db.manager
      .createQueryBuilder()
      .select('id')
      .from('admin_users', 'admin_users')
      .where('enabled=1')
      .orderBy('(id=:p0)', 'DESC')
      .addOrderBy('created_at', 'ASC')
      .addOrderBy('id', 'ASC')
      .limit(1)
      .setParameters({ p0: current?.administrator_id || '' })
      .getRawMany()
    if (!admin) {
      throw ErrorCode.INTERNAL_IMPORT_ADMIN_REQUIRED()
    }
    const collision = await db.manager
      .getRepository(ApplicationImportCredentialEntity)
      .findOne({
        select: { id: true, revoked_at: true },
        where: { token_hash: tokenHash },
      })
    if (collision && collision.id !== current?.id) {
      throw ErrorCode.INTERNAL_IMPORT_TOKEN_REUSED()
    }
    if (current?.token_hash === tokenHash) {
      if (current.revoked_at) {
        throw ErrorCode.INTERNAL_APP_IMPORT_TOKEN_HAS_BEEN_REVOKED_CONFIGURE_A_NEW_TOKEN()
      }
      await db.manager.getRepository(ApplicationImportCredentialEntity).update(
        { id: current.id },
        {
          administrator_id: admin.id,
          apps: [...new Set(apps)],
          expires_at: null,
        },
      )
      await db.commitTransaction()
      return current.id as string
    }
    if (current) {
      await db.manager
        .getRepository(ApplicationImportCredentialEntity)
        .update(
          { id: current.id },
          { managed_key: null, revoked_at: () => 'UTC_TIMESTAMP(3)' },
        )
    }
    const id = randomUUID()
    await db.manager.getRepository(ApplicationImportCredentialEntity).insert({
      id,
      token_hash: tokenHash,
      administrator_id: admin.id,
      apps: [...new Set(apps)],
      expires_at: null,
      managed_key: 'github-actions',
    })
    await db.commitTransaction()
    return id
  } catch (error) {
    if (db.isTransactionActive) {
      await db.rollbackTransaction()
    }
    throw error
  } finally {
    try {
      if (locked) {
        // native-sql: MySQL advisory lock must use this exact connection
        await db.query('SELECT RELEASE_LOCK(\'tbox_github_import_credential\')')
      }
    } finally {
      await db.release()
    }
  }
}
