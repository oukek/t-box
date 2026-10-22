import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { workspaceSourcePaths } from './vite-workspace.mjs'

const tsx = fileURLToPath(new URL('../api/node_modules/tsx/dist/cli.mjs', import.meta.url))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tbox-api-source-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, value) => {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, value)
  }
  put('pnpm-workspace.yaml', 'packages:\n  - api\n  - packages/*\n')
  put('api/package.json', JSON.stringify({ name: '@fixture/api', type: 'module' }))
  put('packages/shared/package.json', JSON.stringify({ name: '@fixture/shared', type: 'module', exports: { '.': { browser: './dist/browser.js', node: './dist/index.js', import: './dist/index.js' } } }))
  put('packages/shared/src/index.ts', 'export { value } from "@fixture/math/add"')
  put('packages/math/package.json', JSON.stringify({ name: '@fixture/math', type: 'module', exports: { './*': { import: './dist/*.js' } } }))
  put('packages/math/src/add.ts', 'export const value: number = 2')
  put('packages/math/dist/add.js', 'export const value = "stale-dist"')
  const paths = workspaceSourcePaths(root)
  assert.equal(paths['@fixture/shared'][0], join(root, 'packages/shared/src/index.ts'))
  assert.equal(paths['@fixture/math/*'][0], join(root, 'packages/math/src/*.ts'))
  assert.equal(paths['@fixture/shared/private'], undefined)
  put('tsconfig.json', JSON.stringify({ compilerOptions: { paths } }))
  put('api/main.ts', 'import { value } from "@fixture/shared"; console.log("VALUE=" + value)')
  return { root, put, config: join(root, 'tsconfig.json'), entry: join(root, 'api/main.ts') }
}

test('API development resolves transitive public source exports without links or dist, ignoring stale compiled output', (t) => {
  const f = fixture(t)
  const result = spawnSync(process.execPath, [tsx, '--tsconfig', f.config, f.entry], { encoding: 'utf8', cwd: f.root })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'VALUE=2')
})

test('one API watcher reloads application source changes without parallel package compilation', async (t) => {
  const f = fixture(t)
  f.put('api/main.ts', 'import { value } from "@fixture/shared"; console.log("VALUE=" + value); setInterval(() => {}, 1000)')
  const child = spawn(process.execPath, [tsx, 'watch', '--clear-screen=false', '--tsconfig', f.config, f.entry], { cwd: f.root, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let errors = ''
  child.stderr.on('data', (chunk) => {
    errors += chunk
  })
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((resolve) => child.once('exit', resolve))
    }
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Source watch did not reload: ${output} ${errors}`)), 10_000)
    let changed = false
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (!changed && output.includes('VALUE=2')) {
        changed = true
        f.put('packages/math/src/add.ts', 'export const value: number = 3')
      }
      if (output.includes('VALUE=3')) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Source watcher exited (${code}): ${errors}`))
    })
  })
})
