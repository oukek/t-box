import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const api = new URL(process.env.VITE_API_BASE_URL || 'https://api.tboxos.cn/api/v1')
if (api.protocol !== 'https:' && !(api.protocol === 'http:' && api.hostname === '127.0.0.1')) {
  throw new Error('桌面 API 地址必须使用 HTTPS 或本机测试地址')
}
for (const args of [
  ['build:contracts'],
  ['--filter', '@t-box/app', 'typecheck'],
  ['--filter', '@t-box/app', 'exec', 'vite', 'build', '--mode', 'desktop', '--outDir', '../desktop/dist', '--emptyOutDir'],
]) {
  const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_API_BASE_URL: api.href } })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}
