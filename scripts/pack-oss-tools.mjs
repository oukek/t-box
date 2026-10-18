import { execFileSync } from 'node:child_process'
import { copyFile, lstat, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDeploymentLinks } from '../deploy/pm2/dependencies.mjs'

const workspace = fileURLToPath(new URL('../', import.meta.url))
const output = process.argv[2] && resolve(process.argv[2])
if (!output || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/pack-oss-tools.mjs NEW_OUTPUT_DIRECTORY')
}
for (const target of [output, output + '.tar.gz']) {
  try {
    await lstat(target)
    throw new Error('Deployment tools output already exists')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
}
const run = (command, args) => execFileSync(command, args, {
  cwd: workspace,
  stdio: 'inherit',
  env: { ...process.env, CI: 'true' },
})
try {
  await mkdir(output, { recursive: true })
  try {
    run('pnpm', ['--filter', '@t-box/oss-deployment', 'deploy', '--legacy', '--prod', join(output, 'oss')])
  } finally {
    run('pnpm', ['install', '--frozen-lockfile', '--prod=false', '--offline'])
  }
  await verifyDeploymentLinks(join(output, 'oss'))
  await mkdir(join(output, 'api'))
  for (const file of ['release-common.sh', 'export-release.sh', 'upload-release.sh', 'download-release.sh', 'deploy-release.sh', 'compose.yaml', '.env.example', 'oss.env.example', 'nginx-api.conf.example']) {
    await copyFile(join(workspace, 'deploy/api', file), join(output, 'api', file))
  }
  // Keep node_modules symlinks intact; GitHub artifact ZIPs alone do not preserve them.
  run('tar', ['-czf', output + '.tar.gz', '-C', output, '.'])
} catch (error) {
  await rm(output + '.tar.gz', { force: true })
  throw error
} finally {
  await rm(output, { recursive: true, force: true })
}
