import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

function fixture(mode, command = 'create', scoped = true) {
  const dir = mkdtempSync(join(tmpdir(), 'dmg retry '))
  try {
    const binary = join(dir, 'fake-hdiutil')
    writeFileSync(binary, `#!/bin/bash
n=0; [[ ! -f "$COUNT" ]] || n=$(cat "$COUNT")
n=$((n+1)); echo "$n" > "$COUNT"
printf '%s\\n' "$@" >> "$ARGS"
if [[ "$MODE" == transient && "$n" -gt 2 ]]; then echo 'created: image.dmg'; exit 0; fi
if [[ "$MODE" == other ]]; then echo 'hdiutil: create failed - Permission denied' >&2; exit 13; fi
echo 'hdiutil: create failed - Resource busy' >&2
exit 16
`, { mode: 0o755 })
    const output = join(scoped ? dir : tmpdir(), 'rw.123.T方舟.dmg')
    const result = spawnSync('/bin/bash', [resolve('scripts/macos-tools/hdiutil'), command, '-srcfolder', join(dir, 'Source app'), output], { encoding: 'utf8', env: { ...process.env, TBOX_HDIUTIL_BIN: binary, TBOX_DMG_OUTPUT_DIR: dir, TBOX_DMG_RETRY_DELAY: '0', COUNT: join(dir, 'count'), ARGS: join(dir, 'args'), MODE: mode } })
    return { ...result, count: Number(readFileSync(join(dir, 'count'))), args: readFileSync(join(dir, 'args'), 'utf8') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
test('busy create retries the same private image, preserving paths and stdout', () => {
  const result = fixture('transient')
  assert.equal(result.status, 0)
  assert.equal(result.count, 3)
  assert.equal(result.stdout.trim(), 'created: image.dmg')
  assert.equal(result.args.split('\n').filter((s) => s === '-ov').length, 2)
  assert.match(result.args, /Source app\n/)
})
test('persistent busy stops after four attempts with original exit status', () => {
  const result = fixture('busy')
  assert.equal(result.status, 16)
  assert.equal(result.count, 4)
})
test('permission failures, unrelated outputs and non-create operations never retry', () => {
  for (const args of [['other'], ['busy', 'attach'], ['busy', 'create', false]]) {
    const result = fixture(...args)
    assert.notEqual(result.status, 0)
    assert.equal(result.count, 1)
  }
})
