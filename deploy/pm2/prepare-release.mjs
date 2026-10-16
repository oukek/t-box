import { execFileSync } from 'node:child_process'
import { lstat, mkdir, readFile, realpath, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Explicitly invoked by the operator. This never starts PM2 or runs a DB migration.
const release = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const info = JSON.parse(await readFile(join(release, 'release-info.json'), 'utf8'))
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 24 || (major === 24 && minor < 15)) {
  throw new Error('Node >=24.15.0 is required; use the build version 24.21.0 when possible')
}
if (basename(dirname(release)) !== 'releases' || basename(release) !== info.releaseId || info.format !== 'tbox-pm2-v1') {
  throw new Error('Expected deployment-root/releases/<releaseId>/control/prepare-release.mjs')
}
if (process.platform !== info.platform || process.arch !== info.architecture) {
  throw new Error('Runtime platform/architecture differs from the release package')
}
const shared = join(dirname(dirname(release)), 'shared')
const envFile = join(shared, 'api.env')
const require = createRequire(join(release, 'api/package.json'))
const { parse } = require('dotenv')
// Read an existing private file. Do not invent credentials or overwrite operator configuration.
const env = parse(await readFile(envFile))
const origin = new URL(env.APP_ARTIFACT_ORIGIN || '')
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('Configure a separate HTTPS APP_ARTIFACT_ORIGIN in shared/api.env')
}
if ((info.artifactOrigin && info.artifactOrigin !== origin.origin) ||
  (info.artifactDelivery && info.artifactDelivery !== (env.APP_ARTIFACT_DELIVERY || 'local'))) {
  throw new Error('shared/api.env artifact origin/delivery differs from the OSS deployment verified by Actions')
}
for (const folder of ['secrets', 'storage', 'app-artifacts', 'app-deployments', 'logs']) {
  await mkdir(join(shared, folder), { recursive: true, mode: 0o700 })
}
await mkdir(join(release, 'output'), { recursive: true })
async function link(path, target) {
  try {
    const stat = await lstat(path)
    if (!stat.isSymbolicLink() || await realpath(path) !== await realpath(target)) {
      throw new Error('Release path already contains different data: ' + path)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
    await symlink(target, path)
  }
}
await link(join(release, 'api/.env'), envFile)
await link(join(release, 'api/.secrets'), join(shared, 'secrets'))
await link(join(release, 'api/.storage'), join(shared, 'storage'))
await link(join(release, 'output/app-artifacts'), join(shared, 'app-artifacts'))
await link(join(release, 'apps'), join(shared, 'app-deployments'))
execFileSync(process.execPath, [join(release, 'scripts/prepare-apps.mjs')], {
  env: { ...process.env, APP_ARTIFACT_ORIGIN: origin.origin },
  stdio: 'inherit',
})
process.stdout.write('Persistent paths prepared. Database migration and PM2 startup remain manual.\n')
