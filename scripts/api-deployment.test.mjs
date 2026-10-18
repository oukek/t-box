import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const deployment = fileURLToPath(new URL('../deploy/api/', import.meta.url))
const ossModule = createRequire(new URL('../deploy/oss/package.json', import.meta.url)).resolve('ali-oss')
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
  if (args.includes('dist/init-db.js') && !args.includes('--check') && process.env.FAKE_FAIL==='initialization') process.exit(9);
  if (args.includes('--check') && process.env.FAKE_FAIL==='preflight') process.exit(8);
  if (args.includes('up') && process.env.FAKE_FAIL==='health') process.exit(10);
}
`
const ossStub = `
import OSS from '${pathToFileURL(ossModule).href}'
import fs from 'node:fs'
import path from 'node:path'
const record = (operation, key, options, bucket) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({tool:'oss-sdk',operation,args:[key],options,bucket})+'\\n')
OSS.prototype.put = async function(key, input, options) {
  record('put', key, options, this.options.bucket)
  if (path.basename(key) === process.env.FAKE_FAIL_UPLOAD) throw new Error('fixture-secret must be sanitized')
  const target = path.join(process.env.FAKE_OSS_ROOT, key)
  fs.mkdirSync(path.dirname(target),{recursive:true})
  fs.writeFileSync(target, Buffer.isBuffer(input) ? input : fs.readFileSync(input))
}
OSS.prototype.getStream = async function(key) {
  record('getStream', key, {}, this.options.bucket)
  const source = path.join(process.env.FAKE_OSS_ROOT, key)
  return {stream:fs.createReadStream(source),res:{headers:{'content-length':String(fs.statSync(source).size)}}}
}
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
  mkdirSync(join(root, 'oss/node_modules'), { recursive: true })
  for (const file of ['client.mjs', 'diagnostics.mjs', 'transfer.mjs', 'package.json']) {
    copyFileSync(new URL('../deploy/oss/' + file, import.meta.url), join(root, 'oss', file))
  }
  const sdkDirectory = dirname(dirname(ossModule))
  symlinkSync(sdkDirectory, join(root, 'oss/node_modules/ali-oss'))
  const preload = join(root, 'mock-sdk.mjs')
  writeFileSync(preload, ossStub)
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
    OSS_REGION: 'cn-hangzhou',
    OSS_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com',
    OSS_ACCESS_KEY_ID: 'fixture-id',
    OSS_ACCESS_KEY_SECRET: 'fixture-secret',
    NODE_OPTIONS: '--import=' + pathToFileURL(preload).href,
    GITHUB_SHA: 'a'.repeat(40),
  }
  // Fixture credentials and SDK methods cannot access a real bucket.
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
  assert.deepEqual(f.logs().filter((row) => row.tool === 'oss-sdk').map((row) => basename(row.args[0])), ['image.tar.gz', 'image.tar.gz.sha256', 'release.json'])
  for (const { args, options, bucket } of f.logs().filter((row) => row.tool === 'oss-sdk')) {
    assert.equal(bucket, 'tboxos-admin')
    assert.ok(args[0].startsWith(`docker/releases/${release}/`))
    assert.equal(options.headers['x-oss-object-acl'], 'public-read')
  }
})

test('failed archive upload never publishes a ready manifest', (t) => {
  const f = fixture(t)
  f.ok(f.run('export-release.sh', [release, f.output]))
  const failed = f.run('upload-release.sh', [release, f.output], { FAKE_FAIL_UPLOAD: 'image.tar.gz' })
  assert.notEqual(failed.status, 0)
  assert.ok(!(failed.stderr + failed.stdout).includes('fixture-secret'))
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
  assert.equal(log.filter((row) => row.args.includes('dist/init-db.js')).length, 2)
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

for (const failure of ['initialization', 'health']) {
  test(failure + ' failure does not advance configured version or deployment state', (t) => {
    const f = fixture(t)
    f.publish()
    assert.notEqual(f.run('deploy-release.sh', [release], { FAKE_FAIL: failure }).status, 0)
    assert.equal(readFileSync(join(f.dir, '.env'), 'utf8'), f.originalEnv)
    assert.equal(existsSync(join(f.dir, 'current-release')), false)
    if (failure === 'initialization') {
      assert.equal(f.logs().some((row) => row.args.includes('up')), false)
    }
  })
}

test('database preflight failure keeps the running container and deployment records untouched', (t) => {
  const f = fixture(t)
  f.publish()
  assert.notEqual(f.run('deploy-release.sh', [release], { FAKE_FAIL: 'preflight' }).status, 0)
  assert.equal(f.logs().some((row) => row.args.includes('stop') || row.args.includes('up')), false)
  assert.equal(readFileSync(join(f.dir, '.env'), 'utf8'), f.originalEnv)
  assert.equal(existsSync(join(f.dir, 'current-release')), false)
})

test('explicit rollback switches code without rerunning initializations or bootstrap', (t) => {
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
