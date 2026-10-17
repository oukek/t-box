import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword } from '../src/admin/crypto.js'
import { AdminStore } from '../src/admin/store.js'
import { ApplicationBuildImports, bundleHash } from '../src/application-platform/build-import.js'
import { createImportCredential, synchronizeImportCredential } from '../src/application-platform/import-credential.js'
import { ApplicationPublishing } from '../src/application-platform/publishing.js'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { createDataSource } from '../src/db/data-source.js'

assert.match(process.env.MYSQL_DATABASE || '', /^t_box_(?:ci|test_[a-z0-9_]+)$/)
const source = await createDataSource().initialize()
const root = await mkdtemp(join(tmpdir(), 'tbox-managed-import-'))
const username = 'managed_' + randomUUID().slice(0, 8)
const tokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex'), randomBytes(32).toString('hex')]
const hashes = tokens.map(bundleHash)
const imports = new ApplicationBuildImports(source, new ApplicationPublishing(source, new ApplicationPlatform(source, [])))
let administrator = ''
let manualId = ''
let disabled = ''
try {
  administrator = await new AdminStore(source).createUser(username, await hashPassword('test123'))
  const directory = join(root, 'api')
  await cp(new URL('../dist/', import.meta.url), join(directory, 'dist'), { recursive: true })
  await writeFile(join(directory, 'package.json'), '{"type":"module"}')
  await writeFile(join(directory, 'bootstrap-applications.json'), JSON.stringify({ calculator: 'a'.repeat(64) }))
  await symlink(fileURLToPath(new URL('../node_modules/', import.meta.url)), join(directory, 'node_modules'))
  const synchronized = spawnSync(process.execPath, [join(directory, 'dist/application-platform/import-credential-cli.js'), 'sync'], {
    env: process.env,
    input: hashes[0],
    encoding: 'utf8',
  })
  assert.equal(synchronized.status, 0, synchronized.stderr)
  assert.ok(!synchronized.stdout.includes(tokens[0]!))
  const initial = await imports.authenticate('Bearer ' + tokens[0])
  assert.deepEqual(initial.apps, ['calculator'])
  const [stored] = await source.query('SELECT token_hash,expires_at,managed_key FROM application_import_credentials WHERE id=?', [initial.id])
  assert.equal(stored.token_hash, hashes[0])
  assert.equal(stored.expires_at, null)
  assert.equal(stored.managed_key, 'github-actions')
  const repeated = await Promise.all([
    synchronizeImportCredential(source, hashes[0]!, ['calculator', 'calendar']),
    synchronizeImportCredential(source, hashes[0]!, ['calculator', 'calendar']),
  ])
  assert.deepEqual(repeated, [initial.id, initial.id])
  assert.deepEqual((await imports.authenticate('Bearer ' + tokens[0])).apps, ['calculator', 'calendar'])
  const manualCredential = await createImportCredential(source, username, ['ledger'], 1)
  manualId = manualCredential.id
  assert.equal((await imports.authenticate('Bearer ' + manualCredential.token)).id, manualId)
  await source.query('UPDATE application_import_credentials SET expires_at=NULL WHERE id=?', [manualId])
  await assert.rejects(imports.authenticate('Bearer ' + manualCredential.token), { code: 'APP_IMPORT_UNAUTHORIZED' })
  await source.query('UPDATE application_import_credentials SET expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY) WHERE id=?', [manualId])
  const replacement = await synchronizeImportCredential(source, hashes[1]!, ['ledger'])
  assert.notEqual(replacement, initial.id)
  await assert.rejects(imports.authenticate('Bearer ' + tokens[0]), { code: 'APP_IMPORT_UNAUTHORIZED' })
  assert.deepEqual((await imports.authenticate('Bearer ' + tokens[1])).apps, ['ledger'])
  const [retired] = await source.query('SELECT revoked_at,managed_key FROM application_import_credentials WHERE id=?', [initial.id])
  assert.ok(retired.revoked_at)
  assert.equal(retired.managed_key, null)
  await assert.rejects(synchronizeImportCredential(source, hashes[0]!, ['calculator']), /already used/)
  assert.equal((await imports.authenticate('Bearer ' + tokens[1])).id, replacement)
  const [manual] = await source.query('SELECT expires_at,managed_key FROM application_import_credentials WHERE id=?', [manualId])
  assert.ok(manual.expires_at)
  assert.equal(manual.managed_key, null)
  disabled = (await imports.authenticate('Bearer ' + tokens[1])).administratorId
  await source.query('UPDATE admin_users SET enabled=0 WHERE id=?', [disabled])
  await assert.rejects(imports.authenticate('Bearer ' + tokens[1]), { code: 'APP_IMPORT_UNAUTHORIZED' })
  await source.query('UPDATE admin_users SET enabled=1 WHERE id=?', [disabled])
  disabled = ''
  await source.query('UPDATE application_import_credentials SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?', [replacement])
  await assert.rejects(imports.authenticate('Bearer ' + tokens[1]), { code: 'APP_IMPORT_UNAUTHORIZED' })
  await assert.rejects(synchronizeImportCredential(source, hashes[1]!, ['ledger']), /revoked/)
  await synchronizeImportCredential(source, hashes[2]!, ['calculator'])
  assert.deepEqual((await imports.authenticate('Bearer ' + tokens[2])).apps, ['calculator'])
  await assert.rejects(synchronizeImportCredential(source, 'invalid', ['calculator']), /Invalid/)
  await assert.rejects(synchronizeImportCredential(source, hashes[2]!, []), /Invalid/)
  console.info('Managed import passed: real deployment CLI/stdin, hash-only storage, no expiry, scoped authentication, concurrent idempotency, atomic rotation, failed-rotation preservation, administrator disable and revocation.')
} finally {
  if (disabled) {
    await source.query('UPDATE admin_users SET enabled=1 WHERE id=?', [disabled])
  }
  await source.query('DELETE FROM application_import_credentials WHERE token_hash IN (?,?,?)', hashes)
  if (manualId) {
    await source.query('DELETE FROM application_import_credentials WHERE id=?', [manualId])
  }
  if (administrator) {
    await source.query('DELETE FROM admin_users WHERE id=?', [administrator])
  }
  await source.destroy()
  await rm(root, { recursive: true, force: true })
}
