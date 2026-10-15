import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Suites temporarily select models/configuration. Never run them in parallel or
// against a developer/production database. dotenv cannot override this explicit env.
if (!/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('Set MYSQL_DATABASE=t_box_ci or t_box_test_<name> and run db:init against that disposable database first')
}
const api = fileURLToPath(new URL('../api/', import.meta.url))
const suites = (await readdir(new URL('../api/test/', import.meta.url)))
  .filter((name) => name.endsWith('.integration.ts'))
  .sort()
for (const suite of suites) {
  process.stdout.write(`\nIntegration: ${suite}\n`)
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', `test/${suite}`], { cwd: api, stdio: 'inherit' })
    const timeout = setTimeout(() => child.kill('SIGTERM'), 180_000)
    const terminate = setTimeout(() => child.kill('SIGKILL'), 190_000)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      clearTimeout(terminate)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${suite} failed (${signal || code})`))
      }
    })
  })
}
process.stdout.write(`\n${suites.length} integration suites completed; optional local client skips are marked above. No live model/payment requests were made.\n`)
