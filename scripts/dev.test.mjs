import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./dev.mjs', import.meta.url))
for (const fail of ['', 'install', 'build:contracts']) {
  test(`development startup prepares links and compiled Node entries before services (${fail || 'success'})`, () => {
    const folder = mkdtempSync(join(tmpdir(), 'tbox-dev-'))
    const log = join(folder, 'calls.jsonl')
    try {
      writeFileSync(join(folder, 'pnpm'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args=process.argv.slice(2);appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(args)+'\\n');
if(args[0]===process.env.FIXTURE_FAIL)process.exit(9);
`, { mode: 0o755 })
      const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, PATH: folder + delimiter + process.env.PATH, FIXTURE_LOG: log, FIXTURE_FAIL: fail } })
      const calls = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      assert.equal(result.status, fail ? 9 : 0, result.stderr)
      assert.deepEqual(calls[0], ['install', '--frozen-lockfile', '--prefer-offline', '--prod=false'])
      assert.equal(calls.length, fail === 'install' ? 1 : fail ? 2 : 3)
      if (!fail) {
        assert.deepEqual(calls[2].slice(0, 3), ['exec', 'concurrently', '--kill-others'])
        assert.ok(calls[2].includes('node scripts/dev-web.mjs'))
        assert.ok(calls[2].includes('pnpm dev:api'))
        assert.ok(!calls[2].includes('pnpm dev:packages'))
        assert.ok(!calls[2].includes('pnpm dev:app'))
      }
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
}
