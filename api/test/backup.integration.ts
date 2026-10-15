import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'

if (!/^(?:t_box_ci|t_box_test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('Backup drill requires an explicit disposable database')
}
const client = spawnSync('mysqldump', ['--version'], { stdio: 'ignore' })
if (client.status !== 0) {
  if (process.env.CI) {
    throw new Error('CI backup drill requires MySQL 8 client tools')
  }
  console.log('SKIP backup MySQL round-trip: mysqldump unavailable; archive authentication is covered by test:operations')
} else {
  const config = getConfig()
  const admin = await createDataSource().initialize()
  const suffix = randomBytes(8).toString('hex')
  const original = `t_box_test_backup_${suffix}`
  const restored = `t_box_test_restore_${suffix}`
  const root = await mkdtemp(join(tmpdir(), 'tbox-backup-drill-'))
  const releaseId = `drill-${suffix}`
  const release = join(root, 'deployment/releases', releaseId)
  const shared = join(root, 'deployment/shared')
  const backup = join(root, 'backup.tbox')
  const key = join(root, 'backup.key')
  const staged = join(root, 'staged')
  let fixture: Awaited<ReturnType<typeof admin.initialize>> | undefined
  let target: typeof fixture
  const run = (command: string, args: string[], input?: Buffer) => {
    const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120_000 })
    // Do not print client diagnostics or private option file contents.
    assert.equal(result.status, 0, `${command} drill failed; inspect the isolated environment`)
  }
  try {
    await admin.query(`CREATE DATABASE \`${original}\``)
    await admin.query(`CREATE DATABASE \`${restored}\``)
    fixture = await createDataSource({ ...config.mysql, database: original }).initialize()
    await fixture.query('CREATE TABLE backup_fixture (id INT PRIMARY KEY, value VARBINARY(100)) ENGINE=InnoDB')
    await fixture.query('INSERT INTO backup_fixture VALUES(1,?)', [Buffer.from('private-drill-中文')])
    await mkdir(join(release, 'api'), { recursive: true, mode: 0o700 })
    await writeFile(join(release, 'api/package.json'), '{"type":"module"}')
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(release, 'api/node_modules'), 'dir')
    await writeFile(join(release, 'release-info.json'), JSON.stringify({ format: 'tbox-pm2-v1', releaseId }))
    for (const folder of ['secrets', 'storage', 'app-artifacts', 'app-deployments']) {
      await mkdir(join(shared, folder), { recursive: true, mode: 0o700 })
      await writeFile(join(shared, folder, 'fixture.txt'), `fixture:${folder}`, { mode: 0o600 })
    }
    const address = `${config.mysql.host.includes(':') ? `[${config.mysql.host}]` : config.mysql.host}:${config.mysql.port}`
    const env = { MYSQL_HOST: address, MYSQL_USERNAME: config.mysql.user, MYSQL_PASSWORD: config.mysql.password, MYSQL_DATABASE: original }
    await writeFile(join(shared, 'api.env'), Object.entries(env).map(([name, value]) => `${name}='${String(value).replaceAll('\'', '\\\'')}'`).join('\n'), { mode: 0o600 })
    await writeFile(key, randomBytes(32).toString('hex'), { mode: 0o600 })
    const script = fileURLToPath(new URL('../../scripts/operations-backup.mjs', import.meta.url))
    run(process.execPath, [script, 'create', release, backup, key, '--quiesced'])
    run(process.execPath, [script, 'stage', backup, key, staged])
    for (const folder of ['secrets', 'storage', 'app-artifacts', 'app-deployments']) {
      assert.equal(await readFile(join(staged, 'shared', folder, 'fixture.txt'), 'utf8'), `fixture:${folder}`)
    }
    const quote = (value: string) => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r') + '"'
    const options = join(root, 'mysql.cnf')
    await writeFile(options, `[client]\nhost=${quote(config.mysql.host)}\nport=${config.mysql.port}\nuser=${quote(config.mysql.user)}\npassword=${quote(config.mysql.password)}\n`, { mode: 0o600 })
    run('mysql', [`--defaults-extra-file=${options}`, restored], await readFile(join(staged, 'database.sql')))
    target = await createDataSource({ ...config.mysql, database: restored }).initialize()
    const [row] = await target.query('SELECT id,value FROM backup_fixture')
    assert.equal(row.id, 1)
    assert.equal(row.value.toString(), 'private-drill-中文')
    console.log('Backup drill passed: real mysqldump, authenticated encrypted archive, file verification and isolated MySQL restore')
  } finally {
    await fixture?.destroy()
    await target?.destroy()
    await admin.query(`DROP DATABASE IF EXISTS \`${original}\``)
    await admin.query(`DROP DATABASE IF EXISTS \`${restored}\``)
    await admin.destroy()
    await rm(root, { recursive: true, force: true })
  }
}
