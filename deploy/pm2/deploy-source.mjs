import { execFileSync } from 'node:child_process'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Run after git pull --ff-only. The checkout is a build directory, never the live PM2 cwd.
const source = await realpath(fileURLToPath(new URL('../../', import.meta.url)))
const args = process.argv.slice(2)
if (args.some((argument) => argument !== '--init-admin')) {
  throw new Error('Usage: node deploy/pm2/deploy-source.mjs [--init-admin]')
}
if (process.platform !== 'linux') {
  throw new Error('Run source deployment on the Linux server, using its own production dependencies')
}
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 24 || (major === 24 && minor < 15)) {
  throw new Error('Node >=24.15.0 is required before installing or building the source')
}
const root = await realpath(resolve(process.env.PM2_DEPLOY_ROOT || '/www/wwwroot/tbox'))
if (root === source || ['releases', 'shared'].some((folder) => source === join(root, folder) || source.startsWith(join(root, folder) + '/'))) {
  throw new Error('Keep the Git checkout in deployment-root/source, separate from releases and shared')
}
process.umask(0o077)
await readFile(join(root, 'shared/api.env'))
const run = (command, arguments_, options = {}) => execFileSync(command, arguments_, { cwd: source, stdio: 'inherit', ...options })
for (const command of ['pnpm', 'pm2', 'tar']) {
  run(command, ['--version'], { stdio: 'ignore' })
}
const sha = run('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
if (!/^[a-f0-9]{40}$/.test(sha)) {
  throw new Error('Unable to identify the source commit')
}
if (run('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()) {
  throw new Error('Commit or discard tracked source changes before deploying; this script never resets Git files')
}
const lock = join(root, '.pm2-build.lock')
try {
  await mkdir(lock, { mode: 0o700 })
} catch (error) {
  if (error.code === 'EEXIST') {
    throw new Error('Another source build holds .pm2-build.lock; inspect its owner.json before removing a stale lock')
  }
  throw error
}
const releaseId = `sha-${sha}-run-${Date.now()}-attempt-1`
const output = join(root, 'incoming', releaseId)
const staging = join(root, 'releases', `.${releaseId}.staging`)
const release = join(dirname(staging), releaseId)
let createdStaging = false
try {
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, source, releaseId }) + '\n', { mode: 0o600 })
  // Compilers are devDependencies, even on a server whose NODE_ENV is production.
  run('pnpm', ['install', '--frozen-lockfile', '--prod=false'], { env: { ...process.env, CI: 'true' } })
  run(process.execPath, [join(source, 'scripts/pack-api-pm2.mjs'), releaseId, output], { env: { ...process.env, GITHUB_SHA: sha } })
  await mkdir(dirname(staging), { recursive: true, mode: 0o700 })
  await mkdir(staging, { mode: 0o700 })
  createdStaging = true
  try {
    await lstat(release)
    throw new Error('Release already exists')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
  run('tar', ['--no-same-owner', '--no-same-permissions', '-xzf', join(output, 'runtime.tar.gz'), '-C', staging])
  await rename(staging, release)
  run(process.execPath, [join(release, 'control/start-release.mjs'), ...args])
} finally {
  if (createdStaging) {
    await rm(staging, { recursive: true, force: true })
  }
  await rm(lock, { recursive: true, force: true })
}
