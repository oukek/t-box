import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiWatchArguments } from './dev-api-options.mjs'
import { workspaceSourcePaths } from './vite-workspace.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const api = resolve(root, 'api')
const cache = resolve(api, 'node_modules/.cache/tbox')
const config = resolve(cache, 'tsconfig.dev.json')
const paths = workspaceSourcePaths(root)
mkdirSync(cache, { recursive: true })
writeFileSync(config, JSON.stringify({
  extends: resolve(api, 'tsconfig.json'),
  compilerOptions: { paths },
}, null, 2) + '\n')
const worker = process.argv.slice(2).includes('--worker')
const child = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
  'exec',
  'tsx',
  ...apiWatchArguments(config, resolve(api, worker ? 'src/worker.ts' : 'src/server.ts'), paths),
], { cwd: api, stdio: 'inherit' })
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
