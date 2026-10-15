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
