import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

if (!/^(?:t_box_ci|t_box_test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('Select an explicit disposable database (t_box_ci or t_box_test_<name>) before browser acceptance')
}
// Serve a real production administration bundle from a different origin, without a Vite API proxy.
const apiBase = `http://127.0.0.1:${process.env.TBOX_TEST_API_PORT || '13000'}/api/v1`
for (const site of ['app', 'admin']) {
  const build = spawnSync('pnpm', ['--filter', '@t-box/' + site, 'build', '--outDir', resolve('output/playwright/static', site), '--emptyOutDir'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_API_BASE_URL: apiBase },
  })
  if (build.error || build.status !== 0) {
    throw new Error('Could not build the cross-origin acceptance bundle')
  }
}
const child = spawn('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit' })
child.once('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
