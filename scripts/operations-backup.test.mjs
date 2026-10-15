import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { archiveBackup, stageBackup } from './operations-backup.mjs'

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
