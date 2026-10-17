import type { DataSource } from 'typeorm'
import { randomBytes, randomUUID } from 'node:crypto'
import { validId } from '@t-box/app-contracts'
import { bundleHash } from './build-import.js'

export async function createImportCredential(source: DataSource, username: string, apps: string[], days: number) {
  if (!apps.length || apps.length > 100 || !apps.every(validId) || !Number.isSafeInteger(days) || days < 1 || days > 365) {
    throw new Error('Provide explicit app IDs and expiry from 1 to 365 days')
  }
  const [admin] = await source.query('SELECT id FROM admin_users WHERE username=? AND enabled=1', [username])
  if (!admin) {
    throw new Error('Enabled administrator not found')
  }
  const id = randomUUID()
  const token = 'tbox_build_' + randomBytes(32).toString('base64url')
  await source.query(
    'INSERT INTO application_import_credentials(id,token_hash,administrator_id,apps,expires_at) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? DAY))',
    [id, bundleHash(token), admin.id, JSON.stringify([...new Set(apps)]), days],
  )
  return { id, token }
}

/** Deployment receives only the SHA-256 digest; the raw GitHub Secret never reaches the server. */
export async function synchronizeImportCredential(source: DataSource, tokenHash: string, apps: string[]) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash) || !apps.length || apps.length > 100 || !apps.every(validId)) {
    throw new Error('Invalid deployment import credential digest or application scope')
  }
  const db = source.createQueryRunner()
  await db.connect()
  let locked = false
  try {
    const [lock] = await db.query('SELECT GET_LOCK(\'tbox_github_import_credential\',30) AS acquired')
    if (Number(lock?.acquired) !== 1) {
      throw new Error('Unable to lock managed import credential synchronization')
    }
    locked = true
    await db.startTransaction()
    const [current] = await db.query('SELECT id,token_hash,administrator_id,revoked_at FROM application_import_credentials WHERE managed_key=\'github-actions\' FOR UPDATE')
    const [admin] = await db.query('SELECT id FROM admin_users WHERE enabled=1 ORDER BY (id=?) DESC,created_at,id LIMIT 1', [current?.administrator_id || ''])
    if (!admin) {
      throw new Error('An enabled administrator is required before import credential synchronization')
    }
    const [collision] = await db.query('SELECT id,revoked_at FROM application_import_credentials WHERE token_hash=?', [tokenHash])
    if (collision && collision.id !== current?.id) {
      throw new Error('APP_IMPORT_TOKEN was already used by another credential; configure a new token')
    }
    if (current?.token_hash === tokenHash) {
      if (current.revoked_at) {
        throw new Error('APP_IMPORT_TOKEN has been revoked; configure a new token')
      }
      await db.query('UPDATE application_import_credentials SET administrator_id=?,apps=?,expires_at=NULL WHERE id=?', [admin.id, JSON.stringify([...new Set(apps)]), current.id])
      await db.commitTransaction()
      return current.id as string
    }
    if (current) {
      await db.query('UPDATE application_import_credentials SET managed_key=NULL,revoked_at=UTC_TIMESTAMP(3) WHERE id=?', [current.id])
    }
    const id = randomUUID()
    await db.query('INSERT INTO application_import_credentials(id,token_hash,administrator_id,apps,expires_at,managed_key) VALUES(?,?,?,?,NULL,\'github-actions\')', [id, tokenHash, admin.id, JSON.stringify([...new Set(apps)])])
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
        await db.query('SELECT RELEASE_LOCK(\'tbox_github_import_credential\')')
      }
    } finally {
      await db.release()
    }
  }
}
