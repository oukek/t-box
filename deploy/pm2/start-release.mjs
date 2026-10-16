import { execFileSync } from 'node:child_process'
import { lstat, mkdir, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const names = ['t-box-api', 't-box-worker', 't-box-artifacts']

export async function startRelease({
  release = fileURLToPath(new URL('../', import.meta.url)),
  initializeAdmin = false,
  run = execFileSync,
  request = globalThis.fetch,
  pause = setTimeout,
  attempts = 60,
} = {}) {
  release = await realpath(release)
  if (!Number.isInteger(attempts) || attempts < 3) {
    throw new Error('At least three health-check attempts are required')
  }
  const root = dirname(dirname(release))
  const shared = join(root, 'shared')
  const api = join(release, 'api')
  const info = JSON.parse(await readFile(join(release, 'release-info.json'), 'utf8'))
  if (dirname(release) !== join(root, 'releases') ||
    !/^sha-[a-f0-9]{40}-run-[1-9]\d*-attempt-[1-9]\d*$/.test(info.releaseId) ||
    release !== join(root, 'releases', info.releaseId) || info.format !== 'tbox-pm2-v1') {
    throw new Error('Expected an unpacked PM2 release under deployment-root/releases/<releaseId>')
  }
  const envFile = join(shared, 'api.env')
  const { parse } = createRequire(join(api, 'package.json'))('dotenv')
  const settings = { ...parse(await readFile(envFile)), ...process.env }
  const port = settings.PORT || '3000'
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('Invalid API PORT')
  }
  const host = !settings.HOST || ['0.0.0.0', '::'].includes(settings.HOST) ? '127.0.0.1' : settings.HOST
  const healthUrl = new URL(`http://${host.includes(':') ? `[${host}]` : host}:${port}/api/v1/health`)
  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    PM2_NODE: process.execPath,
    ARTIFACT_PORT: settings.ARTIFACT_PORT || '6176',
  }
  const command = (program, args, options = {}) => run(program, args, {
    cwd: release,
    stdio: 'inherit',
    env: environment,
    ...options,
  })
  const processes = () => JSON.parse(command('pm2', ['jlist', '--silent'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }))
  const lock = join(root, '.pm2-deploy.lock')
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('Another deployment holds .pm2-deploy.lock; inspect its owner.json before removing a stale lock')
    }
    throw error
  }
  let stopped = false
  const temporaryLinks = []
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, release: info.releaseId, startedAt: new Date().toISOString() }) + '\n', { mode: 0o600 })
    for (const name of ['current', 'previous']) {
      try {
        if (!(await lstat(join(root, name))).isSymbolicLink()) {
          throw new Error(`${name} must be a symbolic link; refusing to replace existing data`)
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error
        }
      }
    }
    command('pm2', ['--version'], { stdio: 'ignore' })
    command(process.execPath, [join(release, 'control/prepare-release.mjs')])
    command(process.execPath, [join(api, 'check-runtime.mjs')])
    const existing = processes().filter((entry) => names.includes(entry.name))
    stopped = true
    // Stop the recovery worker before changing the database, as well as the HTTP API.
    for (const name of ['t-box-worker', 't-box-api']) {
      if (existing.some((entry) => entry.name === name)) {
        command('pm2', ['stop', name])
      }
    }
    command(process.execPath, [join(api, 'dist/init-db.js')])
    if (initializeAdmin) {
      command(process.execPath, [join(api, 'dist/admin/bootstrap.js')])
    }
    // A different absolute release path must replace the old PM2 process definition.
    for (const entry of existing) {
      command('pm2', ['delete', entry.name])
    }
    command('pm2', ['start', join(release, 'control/ecosystem.config.cjs')])
    const scripts = [join(api, 'dist/server.js'), join(api, 'dist/worker.js'), join(release, 'scripts/serve-application-artifacts.mjs')]
    let stable = 0
    let previousGeneration = ''
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const list = processes()
        const current = names.map((name) => list.find((entry) => entry.name === name))
        if (!current.every((entry, index) => entry?.pm2_env?.status === 'online' && entry.pid > 0 && entry.pm2_env.pm_exec_path === scripts[index])) {
          throw new Error('Managed PM2 processes are not online at the new release paths')
        }
        const response = await request(healthUrl, { signal: AbortSignal.timeout(3000), redirect: 'error' })
        const health = (await response.json()).data
        if (!response.ok || health?.status !== 'ok' || health.dependencies?.mysql !== 'up' ||
          health.dependencies?.redis !== (settings.REDIS_ADDR ? 'up' : 'disabled')) {
          throw new Error('API dependencies are not healthy')
        }
        const generation = JSON.stringify(current.map((entry) => [entry.pid, entry.pm2_env.pm_uptime]))
        stable = generation === previousGeneration ? stable + 1 : 1
        previousGeneration = generation
        if (stable >= 3) {
          break
        }
      } catch {
        stable = 0
        previousGeneration = ''
      }
      if (attempt === attempts - 1) {
        throw new Error('New release failed API/PM2 health checks; inspect shared/logs and pm2 status')
      }
      await pause(1000)
    }
    async function updateLink(name, target) {
      const temporary = join(root, `.${name}-${process.pid}`)
      await symlink(target, temporary)
      temporaryLinks.push(temporary)
      await rename(temporary, join(root, name))
    }
    try {
      const previous = await readlink(join(root, 'current'))
      if (resolve(root, previous) !== release) {
        await updateLink('previous', previous)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
    await updateLink('current', relative(root, release))
    command('pm2', ['save'])
    process.stdout.write('Release started and healthy: ' + info.releaseId + '\n')
  } catch (error) {
    if (stopped) {
      try {
        for (const entry of processes().filter((entry) => names.includes(entry.name))) {
          command('pm2', ['stop', entry.name])
        }
      } catch {
        process.stderr.write('Could not stop all managed processes; inspect pm2 status before recovery.\n')
      }
      process.stderr.write('Deployment stopped. Database changes were not rolled back; recover manually before restarting.\n')
    }
    throw error
  } finally {
    for (const path of temporaryLinks) {
      await rm(path, { force: true })
    }
    await rm(lock, { recursive: true, force: true })
  }
}

const entry = process.argv[1] && await realpath(process.argv[1]).catch(() => '')
if (entry && entry === await realpath(fileURLToPath(import.meta.url))) {
  if (process.argv.slice(2).some((value) => value !== '--init-admin')) {
    throw new Error('Usage: node control/start-release.mjs [--init-admin]')
  }
  await startRelease({ initializeAdmin: process.argv.includes('--init-admin') }).catch((error) => {
    process.stderr.write(error.message + '\n')
    process.exitCode = 1
  })
}
