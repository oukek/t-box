import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

test('every repository workflow is manual-only', async () => {
  const folder = new URL('../.github/workflows/', import.meta.url)
  for (const name of await readdir(folder)) {
    if (!/\.ya?ml$/.test(name)) {
      continue
    }
    const source = await readFile(new URL(name, folder), 'utf8')
    const triggers = /^on:[ \t]*\n([\s\S]*?)(?=^\S)/m.exec(source)?.[1]
    assert.ok(triggers, `Workflow triggers missing: ${name}`)
    assert.deepEqual([...triggers.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]), ['workflow_dispatch'], name)
  }
})

test('integration runner refuses implicit or production database selection before launching suites', () => {
  for (const name of ['', 't_box', 'production', 't_box_test_', 't_box_test_a;drop']) {
    const run = spawnSync(process.execPath, ['scripts/test-integration.mjs'], { encoding: 'utf8', env: { ...process.env, MYSQL_DATABASE: name } })
    assert.notEqual(run.status, 0)
    assert.ok(run.stderr.includes('disposable database'))
    assert.equal(run.stdout.includes('Integration:'), false)
  }
})
