import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifyDeploymentLinks } from '../deploy/pm2/dependencies.mjs'

const workspace = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(workspace, 'api/package.json'))
const releaseId = 'sha-' + 'a'.repeat(40) + '-run-123-attempt-1'
const sshStub = `#!/usr/bin/env node
const fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.UPLOAD_LOG, JSON.stringify({tool:'ssh',args})+'\\n');
const index=args.indexOf('bash');
if(index<0) process.exit(2);
const result=cp.spawnSync('bash',args.slice(index+1),{input:fs.readFileSync(0),env:process.env,stdio:['pipe','inherit','inherit']});
process.exit(result.status===null ? 1 : result.status);
`
const scpStub = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.UPLOAD_LOG,JSON.stringify({tool:'scp',args})+'\\n');
const target=args[args.length-1].split(':').slice(1).join(':');
for(const source of args.slice(-4,-1)) fs.copyFileSync(source,path.join(target,path.basename(source)));
if(process.env.CORRUPT_REMOTE==='1') fs.appendFileSync(path.join(target,'runtime.tar.gz'),'corruption');
`
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tbox-pm2-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const server = join(root, 'server')
  const payload = join(root, 'payload')
  const packageDir = join(root, 'package')
  const bin = join(root, 'bin')
  for (const folder of [server, payload, packageDir, bin, join(payload, 'api/dist'), join(payload, 'api/node_modules'), join(payload, 'control'), join(payload, 'scripts')]) {
    mkdirSync(folder, { recursive: true })
  }
  writeFileSync(join(payload, 'api/dist/server.js'), 'process.stdout.write(\'fixture\');\n')
  writeFileSync(join(payload, 'api/package.json'), '{"type":"module"}\n')
  cpSync(dirname(dirname(require.resolve('dotenv'))), join(payload, 'api/node_modules/dotenv'), { recursive: true })
  for (const file of ['prepare-release.mjs', 'ecosystem.config.cjs', 'api.env.example']) {
    copyFileSync(join(workspace, 'deploy/pm2', file), join(payload, 'control', file))
  }
  copyFileSync(join(workspace, 'deploy/api/prepare-apps.mjs'), join(payload, 'scripts/prepare-apps.mjs'))
  copyFileSync(join(workspace, 'scripts/serve-application-artifacts.mjs'), join(payload, 'scripts/serve-application-artifacts.mjs'))
  writeFileSync(join(payload, 'release-info.json'), JSON.stringify({ format: 'tbox-pm2-v1', releaseId, platform: process.platform, architecture: process.arch }))
  const files = { 'index.html': createHash('sha256').update('fixture').digest('hex') }
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex')
  const seed = join(payload, 'bootstrap/app-artifacts/calculator', digest)
  mkdirSync(seed, { recursive: true })
  writeFileSync(join(seed, 'index.html'), 'fixture')
  writeFileSync(join(seed, 'artifact.json'), JSON.stringify({ protocol: 1, appId: 'calculator', digest, files }))
  const tar = spawnSync('tar', ['-czf', join(packageDir, 'runtime.tar.gz'), '-C', payload, '.'], { encoding: 'utf8' })
  assert.equal(tar.status, 0, tar.stderr)
  const bytes = readFileSync(join(packageDir, 'runtime.tar.gz'))
  const sha = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(join(packageDir, 'runtime.tar.gz.sha256'), sha + '  runtime.tar.gz\n')
  writeFileSync(join(packageDir, 'release.json'), JSON.stringify({ format: 'tbox-pm2-v1', releaseId, platform: 'linux', architecture: 'x64', archive: { filename: 'runtime.tar.gz', sha256: sha, size: bytes.length } }))
  writeFileSync(join(bin, 'ssh'), sshStub, { mode: 0o755 })
  writeFileSync(join(bin, 'scp'), scpStub, { mode: 0o755 })
  writeFileSync(join(bin, 'sshpass'), `#!/usr/bin/env node
const fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2);
if(args[0]!=='-d' || args[1]!=='3' || process.env.PM2_SSH_PASSWORD!==undefined) process.exit(2);
if(fs.readFileSync(3,'utf8').trimEnd()!=='fixture password $!#') process.exit(5);
fs.appendFileSync(process.env.UPLOAD_LOG,JSON.stringify({tool:'sshpass',args})+'\\n');
const result=cp.spawnSync(args[2],args.slice(3),{env:process.env,stdio:'inherit'});
process.exit(result.status===null ? 1 : result.status);
`, { mode: 0o755 })
  writeFileSync(join(bin, 'uname'), '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Linux; else echo x86_64; fi\n', { mode: 0o755 })
  writeFileSync(join(root, 'key'), 'fixture key', { mode: 0o600 })
  writeFileSync(join(root, 'known_hosts'), 'fixture.test ssh-ed25519 fixture', { mode: 0o600 })
  mkdirSync(join(server, 'shared'), { recursive: true })
  writeFileSync(join(server, 'shared/api.env'), 'APP_ARTIFACT_ORIGIN=https://apps.example.invalid\nMYSQL_PASSWORD=\'fixture-secret\'\n', { mode: 0o600 })
  symlinkSync('releases/old', join(server, 'current'))
  const env = {
    ...process.env,
    PATH: bin + ':' + process.env.PATH,
    PM2_SSH_HOST: 'fixture.test',
    PM2_SSH_USER: 'deploy',
    PM2_SSH_PORT: '2222',
    PM2_UPLOAD_DIR: server,
    PM2_SSH_KEY_FILE: join(root, 'key'),
    PM2_SSH_KNOWN_HOSTS_FILE: join(root, 'known_hosts'),
    UPLOAD_LOG: join(root, 'upload.jsonl'),
  }
  delete env.PM2_SSH_PASSWORD
  const upload = (extra = {}) => spawnSync('bash', [join(workspace, 'deploy/pm2/upload-runtime.sh'), releaseId, packageDir], { env: { ...env, ...extra }, encoding: 'utf8' })
  const uploaded = join(server, 'releases', releaseId)
  const prepare = () => spawnSync(process.execPath, [join(uploaded, 'control/prepare-release.mjs')], { encoding: 'utf8' })
  return { root, server, packageDir, env, upload, uploaded, prepare }
}

test('upload verifies/extracts a new directory without modifying shared data or current version', (t) => {
  const f = fixture(t)
  const result = f.upload()
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.ok(existsSync(join(f.uploaded, 'api/dist/server.js')))
  assert.equal(existsSync(join(f.uploaded, 'api/.env')), false)
  assert.equal(existsSync(join(f.server, 'shared/logs')), false)
  assert.match(readFileSync(join(f.server, 'shared/api.env'), 'utf8'), /fixture-secret/)
  const calls = readFileSync(f.env.UPLOAD_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(calls.filter((call) => call.tool === 'ssh').every((call) => call.args.includes('StrictHostKeyChecking=yes')))
  assert.equal(calls.some((call) => call.args.some((arg) => arg === 'pm2' || arg === 'dist/init-db.js')), false)
})

test('local checksum failure prevents any SSH connection', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.packageDir, 'runtime.tar.gz'), 'corrupt')
  assert.notEqual(f.upload().status, 0)
  assert.equal(existsSync(f.env.UPLOAD_LOG), false)
})

test('password authentication needs no key, preserves host verification and does not expose the password', (t) => {
  const f = fixture(t)
  const result = f.upload({ PM2_SSH_PASSWORD: 'fixture password $!#', PM2_SSH_KEY_FILE: '' })
  assert.equal(result.status, 0, result.stderr + result.stdout)
  const text = readFileSync(f.env.UPLOAD_LOG, 'utf8')
  const calls = text.trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(calls.filter((call) => call.tool === 'sshpass').length, 3)
  for (const call of calls.filter((call) => call.tool === 'ssh' || call.tool === 'scp')) {
    assert.ok(call.args.includes('BatchMode=no'))
    assert.ok(call.args.includes('PubkeyAuthentication=no'))
    assert.ok(call.args.includes('StrictHostKeyChecking=yes'))
    assert.equal(call.args.includes('-i'), false)
  }
  assert.equal((text + result.stdout + result.stderr).includes('fixture password $!#'), false)
})

test('password mode still rejects absent host keys and line breaks before connecting', (t) => {
  const f = fixture(t)
  assert.notEqual(f.upload({ PM2_SSH_PASSWORD: 'fixture password $!#', PM2_SSH_KEY_FILE: '', PM2_SSH_KNOWN_HOSTS_FILE: '' }).status, 0)
  assert.notEqual(f.upload({ PM2_SSH_PASSWORD: 'invalid\npassword', PM2_SSH_KEY_FILE: '' }).status, 0)
  assert.equal(existsSync(f.env.UPLOAD_LOG), false)
})

test('server checksum failure never publishes an extracted release', (t) => {
  const f = fixture(t)
  assert.notEqual(f.upload({ CORRUPT_REMOTE: '1' }).status, 0)
  assert.equal(existsSync(f.uploaded), false)
})

test('existing version directories are never overwritten', (t) => {
  const f = fixture(t)
  mkdirSync(f.uploaded, { recursive: true })
  writeFileSync(join(f.uploaded, 'marker'), 'preserve')
  assert.notEqual(f.upload().status, 0)
  assert.equal(readFileSync(join(f.uploaded, 'marker'), 'utf8'), 'preserve')
})

test('unsafe upload paths and absent host keys fail before SSH', (t) => {
  const f = fixture(t)
  assert.notEqual(f.upload({ PM2_UPLOAD_DIR: '/tmp/../escape' }).status, 0)
  assert.notEqual(f.upload({ PM2_SSH_KNOWN_HOSTS_FILE: '/does-not-exist' }).status, 0)
  assert.equal(existsSync(f.env.UPLOAD_LOG), false)
})

test('manual preparation creates persistent links idempotently without resetting secrets', (t) => {
  const f = fixture(t)
  assert.equal(f.upload().status, 0)
  let result = f.prepare()
  assert.equal(result.status, 0, result.stderr)
  writeFileSync(join(f.server, 'shared/secrets/provider.key'), 'existing-key')
  result = f.prepare()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(f.server, 'shared/secrets/provider.key'), 'utf8'), 'existing-key')
  assert.equal(realpathSync(join(f.uploaded, 'api/.env')), realpathSync(join(f.server, 'shared/api.env')))
  assert.equal(realpathSync(join(f.uploaded, 'api/.storage')), realpathSync(join(f.server, 'shared/storage')))
  const config = require(join(f.uploaded, 'control/ecosystem.config.cjs'))
  assert.ok(config.apps.every((app) => app.exec_mode === 'fork' && app.instances === 1 && app.watch === false))
  assert.equal(config.apps[0].cwd, join(realpathSync(f.uploaded), 'api'))
})

test('pruned hoisted aliases are removed while portable production links are retained', async (t) => {
  const f = fixture(t)
  const api = join(f.root, 'links')
  const aliases = join(api, 'node_modules/.pnpm/node_modules')
  mkdirSync(aliases, { recursive: true })
  mkdirSync(join(api, 'installed'))
  symlinkSync('../installed', join(api, 'node_modules/portable'))
  symlinkSync(join(f.root, 'payload'), join(aliases, 'workspace'))
  symlinkSync('/missing-pruned-package', join(aliases, 'pruned'))
  await verifyDeploymentLinks(api)
  assert.equal(existsSync(join(aliases, 'workspace')), false)
  assert.equal(realpathSync(join(api, 'node_modules/portable')), realpathSync(join(api, 'installed')))
})

test('a production dependency pointing outside the release is rejected', async (t) => {
  const f = fixture(t)
  const api = join(f.root, 'links')
  mkdirSync(join(api, 'node_modules'), { recursive: true })
  symlinkSync(join(f.root, 'payload'), join(api, 'node_modules/required'))
  await assert.rejects(verifyDeploymentLinks(api), /Nonportable/)
})
