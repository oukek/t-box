import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDeploymentLinks } from '../deploy/pm2/dependencies.mjs'

const workspace = fileURLToPath(new URL('../', import.meta.url))
const [releaseId, outputArgument] = process.argv.slice(2)
if (!/^sha-[a-f0-9]{40}-run-[1-9]\d*-attempt-[1-9]\d*$/.test(releaseId || '') || !outputArgument || process.argv.length !== 4) {
  throw new Error('Usage: node scripts/pack-api-pm2.mjs RELEASE_ID NEW_OUTPUT_DIRECTORY')
}
const output = resolve(outputArgument)
try {
  await lstat(output)
  throw new Error('Output directory already exists')
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error
  }
}
const temporary = await mkdtemp(join(tmpdir(), 'tbox-pm2-pack-'))
const payload = join(temporary, 'payload')
const validation = join(temporary, 'validation')
const packageOutput = join(temporary, 'package')
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: workspace, stdio: 'inherit', ...options })
try {
  await mkdir(payload)
  run('pnpm', ['build:api'])
  run('pnpm', ['-r', '--filter', '@t-box/calculator-web...', '--filter', '@t-box/calendar-web...', '--filter', '@t-box/time-web...', '--filter', '@t-box/ledger-web...', '--if-present', 'build'])
  run('pnpm', ['--filter', '@t-box/api', 'deploy', '--legacy', '--prod', join(payload, 'api')])
  await verifyDeploymentLinks(join(payload, 'api'))
  for (const appId of ['calculator', 'ledger', 'calendar', 'time']) {
    const metadataOutput = run('node', ['scripts/build-application-artifact.mjs', appId], { stdio: 'pipe', encoding: 'utf8' })
    const digest = new RegExp(appId + '/([a-f0-9]{64})').exec(metadataOutput)?.[1]
    if (!digest) {
      throw new Error('Application artifact metadata missing: ' + appId)
    }
    await cp(join(workspace, 'output/app-artifacts', appId, digest), join(payload, 'bootstrap/app-artifacts', appId, digest), { recursive: true })
  }
  await mkdir(join(payload, 'scripts'))
  await mkdir(join(payload, 'control'))
  await cp(join(workspace, 'scripts/serve-application-artifacts.mjs'), join(payload, 'scripts/serve-application-artifacts.mjs'))
  await cp(join(workspace, 'deploy/api/prepare-apps.mjs'), join(payload, 'scripts/prepare-apps.mjs'))
  await cp(join(workspace, 'deploy/api/check-image.mjs'), join(payload, 'api/check-runtime.mjs'))
  for (const file of ['prepare-release.mjs', 'ecosystem.config.cjs', 'api.env.example']) {
    await cp(join(workspace, 'deploy/pm2', file), join(payload, 'control', file))
  }
  const info = {
    format: 'tbox-pm2-v1',
    releaseId,
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.versions.node,
    sourceCommit: process.env.GITHUB_SHA || releaseId.slice(4, 44),
  }
  await writeFile(join(payload, 'release-info.json'), JSON.stringify(info, null, 2) + '\n')
  // Validate a separate copy so placeholder deployment settings never enter the archive.
  await cp(payload, validation, { recursive: true, verbatimSymlinks: true })
  run('node', [join(validation, 'scripts/prepare-apps.mjs')], { env: { ...process.env, APP_ARTIFACT_ORIGIN: 'https://apps.example.invalid' } })
  run('node', [join(validation, 'api/check-runtime.mjs')], { env: { ...process.env, NODE_ENV: 'production' } })
  await mkdir(packageOutput)
  const archive = join(packageOutput, 'runtime.tar.gz')
  run('tar', ['-czf', archive, '-C', payload, '.'])
  const hash = createHash('sha256')
  const { createReadStream } = await import('node:fs')
  for await (const chunk of createReadStream(archive)) {
    hash.update(chunk)
  }
  const sha256 = hash.digest('hex')
  await writeFile(join(packageOutput, 'runtime.tar.gz.sha256'), sha256 + '  runtime.tar.gz\n')
  await writeFile(join(packageOutput, 'release.json'), JSON.stringify({ ...info, archive: { filename: 'runtime.tar.gz', sha256, size: (await stat(archive)).size } }, null, 2) + '\n')
  await mkdir(output, { recursive: true })
  await cp(packageOutput, output, { recursive: true })
  process.stdout.write('PM2 runtime package ready: ' + output + '\n')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
