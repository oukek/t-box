import { mkdir, writeFile } from 'node:fs/promises'
import { createDataSource } from '../db/data-source.js'
import { createImportCredential } from './import-credential.js'

// Administrative server CLI; never executed on module import by the web server.
const args = process.argv.slice(2)
const source = await createDataSource().initialize()
try {
  if (args[0] === 'revoke' && /^[a-f0-9-]{36}$/.test(args[1] || '') && args.length === 2) {
    await source.query('UPDATE application_import_credentials SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?', [args[1]])
    process.stdout.write('Credential revoked.\n')
  } else if (args[0] === 'create' && args.length >= 3 && args.length <= 4) {
    const value = await createImportCredential(source, args[1]!, args[2]!.split(','), Number(args[3] || '90'))
    const directory = new URL('../../.secrets/', import.meta.url)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      await writeFile(new URL(`app-build-${value.id}.txt`, directory), value.token + '\n', { mode: 0o600, flag: 'wx' })
    } catch (error) {
      await source.query('DELETE FROM application_import_credentials WHERE id=?', [value.id])
      throw error
    }
    process.stdout.write(`Credential ${value.id} created; token saved to api/.secrets/app-build-${value.id}.txt (0600).\n`)
  } else {
    throw new Error('Usage: create <administrator username> <appId,appId> [expiryDays=90] | revoke <credentialId>')
  }
} finally {
  await source.destroy()
}
