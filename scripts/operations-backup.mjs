import { spawn } from 'node:child_process'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const magic = Buffer.from('TBOXBK01')
const privateFolders = ['secrets', 'storage', 'app-artifacts', 'app-deployments']
async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    const chunks = []
    let size = 0
    child.stdout?.on('data', (chunk) => {
      size += chunk.length
      if (size > 16 * 1024 * 1024) {
        child.kill()
      } else {
        chunks.push(chunk)
      }
    })
    // Dump errors can contain connection settings. Report an exit code only.
    child.stderr?.resume()
    child.once('error', () => reject(new Error(`${basename(command)} could not start`)))
    child.once('close', (code) => code === 0 && size <= 16 * 1024 * 1024
      ? resolve(Buffer.concat(chunks).toString())
      : reject(new Error(`${basename(command)} failed (${code})`)))
  })
}
async function keyFile(path) {
  const info = await stat(path)
  if (process.platform !== 'win32' && (info.mode & 0o077)) {
    throw new Error('Backup key must be private (chmod 600)')
  }
  const key = (await readFile(path, 'utf8')).trim()
  if (!/^[a-f0-9]{64}$/i.test(key)) {
    throw new Error('Backup key must contain 32 random bytes encoded as 64 hex characters')
  }
  return Buffer.from(key, 'hex')
}
async function files(root, folder = '') {
  const result = []
  for (const name of (await readdir(join(root, folder))).sort()) {
    if (/[\r\n\\]/.test(name)) {
      throw new Error('Unsupported backup filename')
    }
    const path = join(folder, name)
    const info = await lstat(join(root, path))
    if (info.isDirectory()) {
      result.push(...await files(root, path))
    } else if (info.isFile()) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(join(root, path))) {
        hash.update(chunk)
      }
      result.push({ path: path.replaceAll('\\', '/'), size: info.size, sha256: hash.digest('hex') })
    } else {
      throw new Error('Backup paths must be regular files/directories; symlinks and devices are not supported')
    }
  }
  return result
}

/** Encrypt before publishing any backup bytes. Keys never enter argv or manifests. */
export async function sealBackup(source, output, keyPath) {
  const key = await keyFile(keyPath)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(magic)
  const handle = await open(output, 'wx', 0o600)
  try {
    await handle.write(Buffer.concat([magic, iv]))
    await pipeline(createReadStream(source), cipher, createWriteStream(output, { fd: handle.fd, start: 20, autoClose: false }))
    await handle.write(cipher.getAuthTag(), 0, 16, (await handle.stat()).size)
    await handle.sync()
  } catch (error) {
    await rm(output, { force: true })
    throw error
  } finally {
    key.fill(0)
    await handle.close()
  }
}
async function unsealBackup(source, output, keyPath) {
  const key = await keyFile(keyPath)
  const handle = await open(source, 'r')
  try {
    const size = (await handle.stat()).size
    if (size < 36) {
      throw new Error('Invalid backup header')
    }
    const header = Buffer.alloc(20)
    const tag = Buffer.alloc(16)
    await handle.read(header, 0, 20, 0)
    await handle.read(tag, 0, 16, size - 16)
    if (!header.subarray(0, 8).equals(magic)) {
      throw new Error('Unsupported backup format')
    }
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8))
    decipher.setAAD(magic)
    decipher.setAuthTag(tag)
    // Authentication completes before the decrypted archive can be extracted.
    await pipeline(createReadStream(source, { start: 20, end: size - 17 }), decipher, createWriteStream(output, { flags: 'wx', mode: 0o600 }))
  } catch {
    await rm(output, { force: true })
    throw new Error('Backup authentication failed (wrong key, truncated or modified backup)')
  } finally {
    key.fill(0)
    await handle.close()
  }
}
export async function archiveBackup(payload, output, keyPath, metadata = {}) {
  const manifest = { format: 'tbox-backup-v1', createdAt: new Date().toISOString(), ...metadata, files: await files(payload) }
  await writeFile(join(payload, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  const temp = await mkdtemp(join(tmpdir(), 'tbox-backup-archive-'))
  await chmod(temp, 0o700)
  try {
    const archive = join(temp, 'payload.tar.gz')
    await run('tar', ['-czf', archive, '-C', payload, '.'])
    await sealBackup(archive, output, keyPath)
    return manifest
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
/** Verification/staging never imports SQL, overwrites existing paths or starts services. */
export async function stageBackup(archive, keyPath, destination) {
  const temp = await mkdtemp(join(tmpdir(), 'tbox-backup-verify-'))
  await chmod(temp, 0o700)
  let created = false
  try {
    const decrypted = join(temp, 'payload.tar.gz')
    await unsealBackup(archive, decrypted, keyPath)
    const names = (await run('tar', ['-tzf', decrypted])).trim().split('\n')
    for (const name of names) {
      if (isAbsolute(name) || name.includes('\\') || name.split('/').includes('..') || /[\r\0]/.test(name)) {
        throw new Error('Unsafe backup member')
      }
    }
    const listing = (await run('tar', ['-tvzf', decrypted])).trim().split('\n')
    if (listing.some((line) => !/^[d-]/.test(line))) {
      throw new Error('Backup contains a link or unsupported member')
    }
    const output = destination ? resolve(destination) : join(temp, 'verify')
    await mkdir(output, { mode: 0o700 })
    created = true
    await run('tar', ['-xzf', decrypted, '-C', output, '--no-same-owner', '--no-same-permissions'])
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
    if (manifest.format !== 'tbox-backup-v1' || !Array.isArray(manifest.files)) {
      throw new Error('Unsupported backup manifest')
    }
    const actual = (await files(output)).filter((file) => file.path !== 'manifest.json')
    if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) {
      throw new Error('Backup file checksum/size manifest mismatch')
    }
    // tar preserves file modes in its metadata; private directory prevents traversal.
    await chmod(output, 0o700)
    return { createdAt: manifest.createdAt, files: actual.length, ...(destination ? { directory: output } : {}) }
  } catch (error) {
    if (created && destination) {
      await rm(resolve(destination), { recursive: true, force: true })
    }
    throw error
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

async function createBackup(releaseArgument, outputArgument, keyPath, quiesced) {
  if (quiesced !== '--quiesced') {
    throw new Error('Stop API, workers and artifact writes, then pass --quiesced; this command never stops services for you')
  }
  const release = resolve(releaseArgument)
  const shared = join(dirname(dirname(release)), 'shared')
  const output = resolve(outputArgument)
  const info = JSON.parse(await readFile(join(release, 'release-info.json'), 'utf8'))
  if (basename(dirname(release)) !== 'releases' || basename(release) !== info.releaseId || info.format !== 'tbox-pm2-v1') {
    throw new Error('Expected an unpacked PM2 release under deployment-root/releases/<releaseId>')
  }
  if (!relative(shared, output).startsWith('..') || !relative(shared, resolve(keyPath)).startsWith('..')) {
    throw new Error('Store backups and backup keys outside shared data')
  }
  const { createRequire } = await import('node:module')
  const { parse } = createRequire(join(release, 'api/package.json'))('dotenv')
  const env = parse(await readFile(join(shared, 'api.env')))
  if (!/^\w+$/.test(env.MYSQL_DATABASE || '')) {
    throw new Error('Invalid MYSQL_DATABASE')
  }
  const address = new URL(`tcp://${env.MYSQL_HOST || '127.0.0.1:3306'}`)
  const temp = await mkdtemp(join(tmpdir(), 'tbox-backup-create-'))
  await chmod(temp, 0o700)
  try {
    const payload = join(temp, 'payload')
    await mkdir(join(payload, 'shared'), { recursive: true, mode: 0o700 })
    // Credentials live only in a private temporary option file, never process argv.
    const escape = (value) => '"' + String(value ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r') + '"'
    const defaults = join(temp, 'mysql.cnf')
    await writeFile(defaults, `[client]\nhost=${escape(address.hostname.replace(/^\[|\]$/g, ''))}\nport=${address.port || '3306'}\nuser=${escape(env.MYSQL_USERNAME || 'root')}\npassword=${escape(env.MYSQL_PASSWORD)}\n`, { mode: 0o600 })
    const sql = await open(join(payload, 'database.sql'), 'wx', 0o600)
    try {
      await run('mysqldump', [`--defaults-extra-file=${defaults}`, '--single-transaction', '--routines', '--triggers', '--events', '--hex-blob', '--no-tablespaces', '--set-gtid-purged=OFF', '--column-statistics=0', env.MYSQL_DATABASE], { stdio: ['ignore', sql.fd, 'pipe'] })
    } finally {
      await sql.close()
    }
    const { cp } = await import('node:fs/promises')
    for (const folder of privateFolders) {
      await cp(join(shared, folder), join(payload, 'shared', folder), { recursive: true, dereference: false, verbatimSymlinks: true })
    }
    await copyFile(join(shared, 'api.env'), join(payload, 'shared/api.env'))
    await copyFile(join(release, 'release-info.json'), join(payload, 'release-info.json'))
    await archiveBackup(payload, output, keyPath, { releaseId: info.releaseId, database: env.MYSQL_DATABASE, consistency: 'operator-quiesced' })
    await stageBackup(output, keyPath)
    process.stdout.write('Encrypted backup created and verified. Keep its key separately.\n')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'create' && args.length === 4) {
    await createBackup(...args)
  } else if (command === 'verify' && args.length === 2) {
    console.log(await stageBackup(...args))
  } else if (command === 'stage' && args.length === 3) {
    console.log(await stageBackup(...args))
  } else {
    throw new Error('Usage: operations-backup.mjs create RELEASE OUTPUT.tbox KEY --quiesced | verify BACKUP KEY | stage BACKUP KEY NEW_DIRECTORY')
  }
}
