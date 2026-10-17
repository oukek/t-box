import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { archiveBackup, publishBackup, stageBackup } from './operations-backup.mjs'

test('production backup creation refuses a permanent local archive before connecting to any database', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tbox-backup-output-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const release = join(root, 'releases', 'fixture')
  await mkdir(release, { recursive: true })
  await writeFile(join(release, 'release-info.json'), JSON.stringify({ format: 'tbox-pm2-v1', releaseId: 'fixture', artifactDelivery: 'oss' }))
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./operations-backup.mjs', import.meta.url)), 'create', release, join(root, 'must-not-exist.tbox'), join(root, 'key'), '--quiesced'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Production backup output must be an OSS destination/)
})

test('OSS backups accept only encrypted archives in the scoped prefix and publish them with a checksum', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tbox-backup-oss-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const archive = join(root, 'backup.tbox')
  await writeFile(archive, Buffer.concat([Buffer.from('TBOXBK01'), randomBytes(32)]))
  let uploads = 0
  const client = { put: async (path, input, options) => {
    uploads++
    assert.equal(path, 'uploads/resources/backups/fixture.tbox')
    assert.equal(input, archive)
    assert.equal(options.headers['x-oss-object-acl'], 'public-read')
    assert.equal(options.headers['x-oss-forbid-overwrite'], 'true')
    assert.ok(options.headers['Content-MD5'])
  } }
  const settings = { bucket: 'tboxos' }
  const destination = 'oss://tboxos/uploads/resources/backups/fixture.tbox'
  await publishBackup(archive, destination, settings, client)
  assert.equal(uploads, 1)
  await assert.rejects(publishBackup(archive, 'oss://other-bucket/uploads/resources/backups/fixture.tbox', settings, client))
  await assert.rejects(publishBackup(archive, 'oss://tboxos/plaintext.sql', settings, client))
  await writeFile(archive, 'database-password-in-plaintext')
  await assert.rejects(publishBackup(archive, destination, settings, client), /unencrypted/)
  assert.equal(uploads, 1)
})

test('encrypted backup can be verified/staged, rejects tampering, wrong keys and existing targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbox-backup-test-'))
  try {
    const key = join(root, 'key')
    const wrong = join(root, 'wrong')
    for (const file of [key, wrong]) {
      await writeFile(file, randomBytes(32).toString('hex'), { mode: 0o600 })
    }
    const payload = join(root, 'payload')
    await mkdir(join(payload, 'shared/secrets'), { recursive: true })
    await writeFile(join(payload, 'database.sql'), 'CREATE TABLE fixture(id INT);')
    await writeFile(join(payload, 'shared/secrets/vault'), 'private-fixture')
    const archive = join(root, 'backup.tbox')
    const manifest = await archiveBackup(payload, archive, key)
    assert.equal(manifest.files.length, 2)
    assert.equal((await readFile(archive)).includes(Buffer.from('private-fixture')), false)
    assert.equal((await stageBackup(archive, key)).files, 2)
    const output = join(root, 'restore')
    await stageBackup(archive, key, output)
    assert.equal(await readFile(join(output, 'shared/secrets/vault'), 'utf8'), 'private-fixture')
    await assert.rejects(stageBackup(archive, key, output), /exist/)
    assert.equal(await readFile(join(output, 'database.sql'), 'utf8'), 'CREATE TABLE fixture(id INT);')
    await assert.rejects(stageBackup(archive, wrong), /authentication/)
    const damaged = await readFile(archive)
    damaged[25] ^= 1
    await writeFile(join(root, 'damaged'), damaged)
    await assert.rejects(stageBackup(join(root, 'damaged'), key), /authentication/)
    await chmod(key, 0o644)
    await assert.rejects(stageBackup(archive, key), /private/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
