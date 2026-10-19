import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
for (const args of [['install', '--frozen-lockfile', '--prefer-offline', '--prod=false'], ['build:contracts']]) {
  const result = spawnSync(pnpm, args, { cwd, stdio: 'inherit' })
  if (result.error || result.status !== 0) {
    console.error(`Development preparation failed: pnpm ${args[0]}. Resolve the error before starting services.`)
    process.exit(result.status || 1)
  }
}
const child = spawn(pnpm, [
  'exec',
  'concurrently',
  '--kill-others',
  '-n',
  'api,app,admin,apps,artifacts,packages',
  '-c',
  'cyan,green,magenta,blue,white,yellow',
  'pnpm dev:api',
  'pnpm dev:app',
  'pnpm dev:admin',
  'pnpm dev:apps',
  'node scripts/serve-application-artifacts.mjs 6176 0.0.0.0',
  'pnpm dev:packages',
], { cwd, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal))
}
child.once('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
