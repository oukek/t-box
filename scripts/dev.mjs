import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
for (const [label, args] of [
  ['[1/3] 校验依赖与工作区链接…', ['install', '--frozen-lockfile', '--prefer-offline', '--prod=false']],
  ['[2/3] 准备后端依赖与应用声明…', ['build:contracts']],
]) {
  console.info(label)
  const result = spawnSync(pnpm, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if (result.error) {
      console.error(result.error.message)
    }
    console.error(`Development preparation failed: pnpm ${args[0]}. Resolve the error before starting services.`)
    process.exit(result.status || 1)
  }
}
console.info('[3/3] 启动 API，健康检查通过后启动网页、后台和全部子应用…')
const child = spawn(pnpm, [
  'exec',
  'concurrently',
  '--kill-others',
  '-n',
  'api,web',
  '-c',
  'cyan,green',
  'pnpm dev:api',
  'node scripts/dev-web.mjs',
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
