import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { waitForApi } from './dev-readiness.mjs'

const controller = new AbortController()
let child
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    controller.abort()
    child?.kill(signal)
  })
}
try {
  await waitForApi({ signal: controller.signal })
  console.info('API 就绪：http://127.0.0.1:6868/api/v1/health')
  console.info('前端：http://127.0.0.1:5173  |  后台：http://127.0.0.1:5175')
  child = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
    'exec',
    'concurrently',
    '--kill-others',
    '-n',
    'app,admin,apps,artifacts',
    '-c',
    'green,magenta,blue,white',
    'pnpm dev:app',
    'pnpm dev:admin',
    'pnpm dev:apps',
    'node scripts/serve-application-artifacts.mjs 6176 0.0.0.0',
  ], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' })
  child.once('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  child.once('exit', (code) => {
    process.exitCode = code ?? 1
  })
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(error.message)
    process.exitCode = 1
  }
}
