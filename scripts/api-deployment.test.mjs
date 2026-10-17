import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const deployment = fileURLToPath(new URL('../deploy/api/', import.meta.url))
const release = 'sha-' + 'a'.repeat(40) + '-run-123-attempt-1'
const imageId = 'sha256:' + 'b'.repeat(64)
const dockerStub = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({tool:'docker',args,image:process.env.API_IMAGE})+'\\n');
if (args[0]==='info') console.log('linux/'+(process.env.FAKE_SERVER_ARCH || 'amd64'));
else if (args[0]==='image' && args[1]==='save') process.stdout.write('fake-docker-image-archive');
else if (args[0]==='image' && args[1]==='inspect') console.log(JSON.stringify([{Id:process.env.FAKE_IMAGE_ID,Os:'linux',Architecture:'amd64'}]));
else if (args[0]==='compose') {
  if (args.includes('dist/init-db.js') && process.env.FAKE_FAIL==='migration') process.exit(9);
  if (args.includes('up') && process.env.FAKE_FAIL==='health') process.exit(10);
}
`
const ossStub = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({tool:'ossutil',args})+'\\n');
const mapped = v => v.startsWith('oss://') ? path.join(process.env.FAKE_OSS_ROOT,v.replace(/^oss:\\/\\/[^/]+\\//,'')) : v;
if(args[0]!=='cp') process.exit(2);
const source=mapped(args[1]), target=mapped(args[2]);
if(args[2].startsWith('oss://') && path.basename(source)===process.env.FAKE_FAIL_UPLOAD) process.exit(8);
try { fs.mkdirSync(path.dirname(target),{recursive:true}); fs.copyFileSync(source,target); }
catch { process.exit(3); }
`

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tbox-deploy-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'deploy')
  const bin = join(root, 'bin')
  mkdirSync(dir)
  mkdirSync(bin)
  for (const file of ['release-common.sh', 'export-release.sh', 'upload-release.sh', 'download-release.sh', 'deploy-release.sh', 'compose.yaml']) {
    copyFileSync(join(deployment, file), join(dir, file))
  }
  writeFileSync(join(bin, 'docker'), dockerStub, { mode: 0o755 })
  writeFileSync(join(bin, 'ossutil'), ossStub, { mode: 0o755 })
  // Only command sequencing is mocked; SHA-256, gzip, jq, and file operations are real.
  writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const env = {
    ...process.env,
    PATH: bin + ':' + process.env.PATH,
    FAKE_LOG: join(root, 'commands.jsonl'),
    FAKE_OSS_ROOT: join(root, 'oss'),
    FAKE_IMAGE_ID: imageId,
    OSS_BUCKET: '',
    OSS_PREFIX: '',
    OSSUTIL_CONFIG_FILE: join(root, 'unused-config'),
    GITHUB_SHA: 'a'.repeat(40),
  }
  // Do not allow a test to use any real OSS access credentials.
  delete env.OSS_ACCESS_KEY_ID
  delete env.OSS_ACCESS_KEY_SECRET
  delete env.OSS_SESSION_TOKEN
  const originalEnv = 'API_IMAGE=t-box-api:old\nMYSQL_PASSWORD=\'fixture$#\'\nAPP_ARTIFACT_ORIGIN=https://apps.example.invalid\n'
  writeFileSync(join(dir, '.env'), originalEnv)
  const output = join(root, 'export')
  const remote = join(env.FAKE_OSS_ROOT, 'docker/releases', release)
  const run = (script, args, extra = {}) => spawnSync('bash', [join(dir, script), ...args], { env: { ...env, ...extra }, encoding: 'utf8' })
  const ok = (result) => assert.equal(result.status, 0, result.stderr + result.stdout)
  const logs = () => existsSync(env.FAKE_LOG) ? readFileSync(env.FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map((row) => JSON.parse(row)) : []
  const resetLogs = () => writeFileSync(env.FAKE_LOG, '')
  const publish = () => {
    ok(run('export-release.sh', [release, output]))
    ok(run('upload-release.sh', [release, output]))
    resetLogs()
  }
  return { dir, output, remote, run, ok, logs, resetLogs, publish, originalEnv }
}

test('export creates a checked archive; publication marker is uploaded last', (t) => {
  const f = fixture(t)
  f.ok(f.run('export-release.sh', [release, f.output]))
  const manifest = JSON.parse(readFileSync(join(f.output, 'release.json'), 'utf8'))
  assert.equal(manifest.image.id, imageId)
  assert.equal(manifest.image.tag, 't-box-api:' + release)
  f.ok(f.run('upload-release.sh', [release, f.output]))
  assert.deepEqual(f.logs().filter((row) => row.tool === 'ossutil').map((row) => basename(row.args[1])), ['image.tar.gz', 'image.tar.gz.sha256', 'release.json'])
  for (const { args } of f.logs().filter((row) => row.tool === 'ossutil')) {
    assert.ok(args[2].startsWith(`oss://tboxos-admin/docker/releases/${release}/`))
    assert.equal(args[args.indexOf('--acl') + 1], 'public-read')
  }
})

test('failed archive upload never publishes a ready manifest', (t) => {
  const f = fixture(t)
  f.ok(f.run('export-release.sh', [release, f.output]))
  assert.notEqual(f.run('upload-release.sh', [release, f.output], { FAKE_FAIL_UPLOAD: 'image.tar.gz' }).status, 0)
  assert.equal(existsSync(join(f.remote, 'release.json')), false)
})

test('download verifies and imports before stopping the old API; initialization runs once', (t) => {
  const f = fixture(t)
  f.publish()
  f.ok(f.run('deploy-release.sh', [release, '--init']))
  const log = f.logs()
  const load = log.findIndex((row) => row.args.includes('load'))
  const stop = log.findIndex((row) => row.args.includes('stop'))
  assert.ok(load >= 0 && stop > load)
  assert.equal(log.filter((row) => row.args.includes('dist/init-db.js')).length, 1)
  assert.equal(log.filter((row) => row.args.includes('dist/admin/bootstrap.js')).length, 1)
  assert.ok(log.some((row) => row.args.includes('--wait') && row.args.includes('up')))
  assert.ok(readFileSync(join(f.dir, '.env'), 'utf8').includes('MYSQL_PASSWORD=\'fixture$#\''))
  assert.ok(readFileSync(join(f.dir, '.env'), 'utf8').includes('API_IMAGE=t-box-api:' + release))
  assert.equal(readFileSync(join(f.dir, 'current-release'), 'utf8').trim(), release)
})

for (const corruption of ['archive', 'checksum', 'manifest']) {
  test(corruption + ' corruption prevents image import and application downtime', (t) => {
    const f = fixture(t)
    f.publish()
    if (corruption === 'manifest') {
      const file = join(f.remote, 'release.json')
      const data = JSON.parse(readFileSync(file, 'utf8'))
      data.image.tag = 'another-image:latest'
      writeFileSync(file, JSON.stringify(data))
    } else {
      writeFileSync(join(f.remote, corruption === 'archive' ? 'image.tar.gz' : 'image.tar.gz.sha256'), 'corrupt')
    }
    assert.notEqual(f.run('deploy-release.sh', [release]).status, 0)
    assert.equal(f.logs().some((row) => row.args.includes('load') || row.args.includes('stop')), false)
    assert.equal(readFileSync(join(f.dir, '.env'), 'utf8'), f.originalEnv)
  })
}

test('wrong server architecture is rejected before Docker load', (t) => {
  const f = fixture(t)
  f.publish()
  assert.notEqual(f.run('deploy-release.sh', [release], { FAKE_SERVER_ARCH: 'arm64' }).status, 0)
  assert.equal(f.logs().some((row) => row.args.includes('load') || row.args.includes('stop')), false)
})

test('same-size archive tampering fails the actual SHA-256 check', (t) => {
  const f = fixture(t)
  f.publish()
  const file = join(f.remote, 'image.tar.gz')
  const bytes = readFileSync(file)
  bytes[bytes.length - 1] ^= 1
  writeFileSync(file, bytes)
  const result = f.run('deploy-release.sh', [release])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Image SHA-256 verification failed/)
  assert.equal(f.logs().some((row) => row.args.includes('load') || row.args.includes('stop')), false)
})

test('wrong imported image ID prevents deployment', (t) => {
  const f = fixture(t)
  f.publish()
  assert.notEqual(f.run('deploy-release.sh', [release], { FAKE_IMAGE_ID: 'sha256:' + 'c'.repeat(64) }).status, 0)
  assert.equal(f.logs().some((row) => row.args.includes('stop')), false)
})

test('downloaded image archives are removed after import and every import is verified afresh', (t) => {
  const f = fixture(t)
  f.publish()
  f.ok(f.run('download-release.sh', [release]))
  const loaded = f.logs().find((row) => row.tool === 'docker' && row.args.includes('load'))
  assert.ok(loaded)
  assert.equal(existsSync(loaded.args[loaded.args.indexOf('--input') + 1]), false)
  assert.equal(existsSync(join(f.dir, 'releases', release)), false)
  writeFileSync(join(f.remote, 'image.tar.gz'), 'corrupt-remote')
  f.resetLogs()
  assert.notEqual(f.run('download-release.sh', [release]).status, 0)
  assert.equal(f.logs().some((row) => row.args.includes('load')), false)
})

for (const failure of ['migration', 'health']) {
  test(failure + ' failure does not advance configured version or deployment state', (t) => {
    const f = fixture(t)
    f.publish()
    assert.notEqual(f.run('deploy-release.sh', [release], { FAKE_FAIL: failure }).status, 0)
    assert.equal(readFileSync(join(f.dir, '.env'), 'utf8'), f.originalEnv)
    assert.equal(existsSync(join(f.dir, 'current-release')), false)
    if (failure === 'migration') {
      assert.equal(f.logs().some((row) => row.args.includes('up')), false)
    }
  })
}

test('explicit rollback switches code without rerunning migrations or bootstrap', (t) => {
  const f = fixture(t)
  f.publish()
  writeFileSync(join(f.dir, 'current-release'), 'prior-release\n')
  f.ok(f.run('deploy-release.sh', [release, '--rollback']))
  assert.equal(f.logs().some((row) => row.args.includes('dist/init-db.js') || row.args.includes('dist/admin/bootstrap.js') || row.args.includes('prepare-apps')), false)
  assert.equal(readFileSync(join(f.dir, 'previous-release'), 'utf8'), 'prior-release\n')
})

test('unsafe release identifiers are rejected without shell execution', (t) => {
  const f = fixture(t)
  assert.notEqual(f.run('deploy-release.sh', ['../../escape']).status, 0)
  assert.deepEqual(f.logs(), [])
})
