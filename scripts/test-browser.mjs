import { spawn } from 'node:child_process'

if (!/^(?:t_box_ci|t_box_test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('Select an explicit disposable database (t_box_ci or t_box_test_<name>) before browser acceptance')
}
const child = spawn('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit' })
child.once('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
