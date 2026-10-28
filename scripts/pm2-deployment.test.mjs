import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDeploymentLinks } from '../deploy/pm2/dependencies.mjs'
import { importTokenHash } from '../deploy/pm2/import-token.mjs'
import { startRelease } from '../deploy/pm2/start-release.mjs'

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
const sources=args.slice(args.indexOf('-P')+2,-1);
for(const source of sources) fs.copyFileSync(source,target.endsWith('/')?path.join(target,path.basename(source)):target);
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
  writeFileSync(join(payload, 'api/bootstrap-applications.json'), JSON.stringify({ calculator: 'a'.repeat(64) }))
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
  writeFileSync(join(root, 'known_hosts'), '[fixture.test]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n', { mode: 0o600 })
  mkdirSync(join(server, 'shared'), { recursive: true })
  writeFileSync(join(server, 'shared/api.env'), 'APP_ARTIFACT_ORIGIN=https://apps.example.invalid\nMYSQL_PASSWORD=\'fixture-secret\'\n', { mode: 0o600 })
  symlinkSync('releases/old', join(server, 'current'))
  const isolatedEnvironment = { ...process.env }
  for (const key of Object.keys(isolatedEnvironment)) {
    if (/^(?:OSS_|REDIS_|APP_ARTIFACT_|APP_IMPORT_|WEB_ORIGIN$|ADMIN_ORIGIN$|API_BASE_URL$|WEB_OSS_|ADMIN_OSS_|APPS_OSS_)/.test(key)) {
      delete isolatedEnvironment[key]
    }
  }
  const env = {
    ...isolatedEnvironment,
    PATH: bin + ':' + process.env.PATH,
    PM2_SSH_HOST: 'fixture.test',
    PM2_SSH_USER: 'deploy',
    PM2_SSH_PORT: '2222',
    PM2_UPLOAD_DIR: server,
    PM2_START_SERVICES: 'false',
    PM2_INIT_ADMIN: 'false',
    PM2_SSH_KEY_FILE: join(root, 'key'),
    PM2_SSH_KNOWN_HOSTS_FILE: join(root, 'known_hosts'),
    UPLOAD_LOG: join(root, 'upload.jsonl'),
  }
  delete env.PM2_SSH_PASSWORD
  const upload = (extra = {}) => spawnSync('bash', [join(workspace, 'deploy/pm2/upload-runtime.sh'), releaseId, packageDir], { env: { ...env, ...extra }, encoding: 'utf8' })
  const uploaded = join(server, 'releases', releaseId)
  const prepare = () => spawnSync(process.execPath, [join(uploaded, 'control/prepare-release.mjs')], { encoding: 'utf8', env })
  return { root, server, packageDir, env, upload, uploaded, prepare }
}

function startupFixture(t, { initializationFails = false, preflightFails = false, storageFails = false, importFails = false, healthy = true, wrongScript = false, restarts = false, redisDown = false, oss = false } = {}) {
  const f = fixture(t)
  assert.equal(f.upload().status, 0)
  if (oss) {
    writeFileSync(join(f.server, 'shared/api.env'), 'APP_ARTIFACT_ORIGIN=https://apps.example.invalid\nAPP_ARTIFACT_DELIVERY=oss\n')
  }
  const commands = []
  const release = realpathSync(f.uploaded)
  const scripts = [join(release, 'api/dist/server.js'), join(release, 'api/dist/worker.js'), join(release, 'scripts/serve-application-artifacts.mjs')]
  let list = ['t-box-api', 't-box-worker', 't-box-artifacts', 'other-service'].map((name, index) => ({ name, pid: index + 1, pm2_env: { status: 'online', pm_exec_path: '/old/' + name, pm_uptime: 1 } }))
  let healthRequests = 0
  let importInput
  const run = (program, args, options) => {
    commands.push([program === process.execPath ? 'node' : program, ...args])
    if (program === process.execPath) {
      if (args[0].endsWith('import-credential-cli.js')) {
        importInput = { input: options.input, stdio: options.stdio }
      }
      if (storageFails && args[0] === '--input-type=module') {
        throw new Error('业务文件 OSS 配置不完整')
      }
      if (args[0].endsWith('prepare-release.mjs')) {
        return execPreparation()
      }
      if (preflightFails && args[0].endsWith('init-db.js') && args.includes('--check')) {
        throw new Error('fixture preflight failure')
      }
      if (initializationFails && args[0].endsWith('init-db.js') && !args.includes('--check')) {
        throw new Error('fixture initialization failure')
      }
      if (importFails && args[0].endsWith('import-credential-cli.js')) {
        throw new Error('fixture import credential synchronization failure')
      }
      return ''
    }
    if (args[0] === 'jlist') {
      if (restarts) {
        list = list.map((entry) => entry.name === 'other-service' ? entry : { ...entry, pid: entry.pid + 1 })
      }
      return JSON.stringify(list)
    }
    if (args[0] === 'delete') {
      list = list.filter((entry) => entry.name !== args[1])
    }
    if (args[0] === 'stop') {
      list = list.map((entry) => entry.name === args[1] ? { ...entry, pm2_env: { ...entry.pm2_env, status: 'stopped' } } : entry)
    }
    if (args[0] === 'start') {
      assert.equal(options.env.NODE_ENV, 'production')
      assert.equal(options.env.PM2_NODE, process.execPath)
      const names = options.env.APP_ARTIFACT_DELIVERY === 'oss' ? ['t-box-api', 't-box-worker'] : ['t-box-api', 't-box-worker', 't-box-artifacts']
      list.push(...names.map((name, index) => ({ name, pid: index + 10, pm2_env: { status: 'online', pm_exec_path: wrongScript ? '/old/script.js' : scripts[index], pm_uptime: 100 } })))
    }
    return ''
  }
  function execPreparation() {
    const result = f.prepare()
    assert.equal(result.status, 0, result.stderr)
    return ''
  }
  const request = async (url) => {
    healthRequests++
    assert.equal(url.pathname, '/api/v1/health')
    return new Response(JSON.stringify({ data: { status: healthy && !redisDown ? 'ok' : 'degraded', dependencies: { mysql: 'up', redis: redisDown ? 'down' : f.env.REDIS_ADDR ? 'up' : 'disabled' } } }))
  }
  const start = (extra = {}) => startRelease({ release: f.uploaded, run, request, pause: async () => {}, attempts: 4, processEnvironment: f.env, ...extra })
  return { ...f, commands, start, processes: () => list, healthRequests: () => healthRequests, importInput: () => importInput }
}

test('configured tokens are validated and only their digest is written or uploaded separately from the public package', (t) => {
  const f = fixture(t)
  const token = 'deployment_fixture_' + 'A'.repeat(45)
  const file = join(f.root, 'import-token.sha256')
  const hashed = spawnSync(process.execPath, [join(workspace, 'deploy/pm2/import-token.mjs'), file], { env: { ...f.env, APP_IMPORT_TOKEN: token }, encoding: 'utf8' })
  assert.equal(hashed.status, 0, hashed.stderr)
  assert.equal(readFileSync(file, 'utf8'), importTokenHash(token) + '\n')
  assert.equal(hashed.stdout, '')
  assert.equal(f.upload({ PM2_IMPORT_TOKEN_HASH_FILE: file }).status, 0)
  assert.equal(readFileSync(join(f.uploaded, 'control/app-import.sha256'), 'utf8'), importTokenHash(token) + '\n')
  assert.equal(existsSync(join(f.server, 'incoming', releaseId)), false)
  assert.ok(!readFileSync(f.env.UPLOAD_LOG, 'utf8').includes(token))
  assert.equal(existsSync(join(f.packageDir, 'import-token.sha256')), false)
  for (const value of ['', 'short', 'a'.repeat(129), 'a'.repeat(32) + '\n', 'a'.repeat(32) + ' ']) {
    assert.throws(() => importTokenHash(value))
  }
})

test('managed credential synchronization runs after initialization and admin bootstrap, before PM2 starts', async (t) => {
  const f = startupFixture(t)
  writeFileSync(join(f.uploaded, 'control/app-import.sha256'), 'a'.repeat(64))
  await f.start({ initializeAdmin: true })
  assert.deepEqual(f.importInput(), { input: 'a'.repeat(64), stdio: ['pipe', 'inherit', 'inherit'] })
  const index = (part) => f.commands.findIndex((args) => args.some((arg) => arg.endsWith(part)))
  assert.ok(index('init-db.js') < index('admin/bootstrap.js'))
  assert.ok(index('admin/bootstrap.js') < index('import-credential-cli.js'))
  assert.ok(index('import-credential-cli.js') < f.commands.findIndex((args) => args[0] === 'pm2' && args[1] === 'start'))
})

test('the actual Actions upload step removes the raw token before SSH and stages only its hash', (t) => {
  const f = fixture(t)
  const workflow = readFileSync(join(workspace, '.github/workflows/api-pm2.yml'), 'utf8')
  assert.ok(workflow.includes('secrets.PM2_SSH_KNOWN_HOSTS'))
  const step = workflow.split('      - name: Upload, verify and optionally start PM2\n')[1].split('      - name: Verify public HTTPS API and administration origin\n')[0]
  const script = step.split('        run: |\n')[1].split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n')
  const secret = 'actions_fixture_' + 'B'.repeat(48)
  symlinkSync(f.packageDir, join(f.root, 'pm2-package'))
  for (const name of ['ssh', 'scp']) {
    const path = join(f.root, 'bin', name)
    const stub = readFileSync(path, 'utf8')
    writeFileSync(path, stub.replace('#!/usr/bin/env node\n', '#!/usr/bin/env node\nif (process.env.APP_IMPORT_TOKEN) process.exit(90);\n'), { mode: 0o755 })
  }
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd: workspace,
    encoding: 'utf8',
    env: { ...f.env, RUNNER_TEMP: f.root, RELEASE_ID: releaseId, PM2_SSH_PRIVATE_KEY: 'fixture-key', PM2_SSH_KNOWN_HOSTS: readFileSync(f.env.PM2_SSH_KNOWN_HOSTS_FILE, 'utf8'), APP_IMPORT_TOKEN: secret },
  })
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.equal(readFileSync(join(f.uploaded, 'control/app-import.sha256'), 'utf8'), importTokenHash(secret) + '\n')
  assert.ok(!(result.stdout + result.stderr + readFileSync(f.env.UPLOAD_LOG, 'utf8')).includes(secret))
  assert.equal(existsSync(join(f.server, 'incoming', releaseId)), false)
})

test('invalid hashes fail before downtime and failed synchronization cannot start or save the new API', async (t) => {
  const f = startupFixture(t, { importFails: true })
  const file = join(f.uploaded, 'control/app-import.sha256')
  writeFileSync(file, 'invalid')
  await assert.rejects(f.start(), /SHA-256/)
  assert.equal(f.commands.length, 0)
  writeFileSync(file, 'a'.repeat(64))
  await assert.rejects(f.start(), /synchronization failure/)
  assert.equal(f.commands.some((args) => args[0] === 'pm2' && ['start', 'save'].includes(args[1])), false)
})

test('missing server OSS credentials fail before stopping existing PM2 services', async (t) => {
  const f = startupFixture(t, { storageFails: true, oss: true })
  await assert.rejects(f.start(), /OSS 配置不完整/)
  assert.equal(f.commands.some((command) => command[0] === 'pm2' && command[1] === 'stop'), false)
  assert.equal(f.commands.some((command) => command.some((value) => value.endsWith('init-db.js'))), false)
  assert.equal(f.processes().find((entry) => entry.name === 't-box-api').pm2_env.status, 'online')
})

test('OSS delivery starts only API and worker and removes an old local artifact process', async (t) => {
  const f = startupFixture(t, { oss: true })
  await f.start()
  assert.deepEqual(f.processes().map((entry) => entry.name).sort(), ['other-service', 't-box-api', 't-box-worker'])
  assert.ok(f.commands.some((args) => args.join(' ') === 'pm2 delete t-box-artifacts'))
  assert.ok(f.commands.some((args) => args.join(' ') === 'pm2 save'))
})

test('Actions release metadata starts OSS services without duplicated application settings in api.env', async (t) => {
  const f = startupFixture(t)
  const path = join(f.uploaded, 'release-info.json')
  const info = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, JSON.stringify({ ...info, artifactOrigin: 'https://apps.example.invalid', artifactDelivery: 'oss', artifactImportOrigin: 'https://tboxos-app.oss-cn-hangzhou.aliyuncs.com', artifactImportPrefix: 'builds' }))
  writeFileSync(join(f.server, 'shared/api.env'), 'MYSQL_PASSWORD=\'fixture-secret\'\n')
  await f.start()
  assert.deepEqual(f.processes().map((entry) => entry.name).sort(), ['other-service', 't-box-api', 't-box-worker'])
  assert.ok(readFileSync(join(f.server, 'shared/api.env'), 'utf8').includes('fixture-secret'))
  assert.ok(!readFileSync(join(f.server, 'shared/api.env'), 'utf8').includes('APP_ARTIFACT'))
})

test('effective settings cannot override the release OSS deployment contract', async (t) => {
  const f = startupFixture(t, { oss: true })
  const path = join(f.uploaded, 'release-info.json')
  const info = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, JSON.stringify({ ...info, artifactDelivery: 'local' }))
  await assert.rejects(f.start(), /Effective artifact settings/)
  assert.equal(f.commands.length, 0)
})

test('server configuration must match the OSS origin and delivery recorded in the uploaded release', (t) => {
  const f = fixture(t)
  assert.equal(f.upload().status, 0)
  const infoPath = join(f.uploaded, 'release-info.json')
  const info = JSON.parse(readFileSync(infoPath, 'utf8'))
  writeFileSync(infoPath, JSON.stringify({ ...info, artifactOrigin: 'https://other.example.invalid', artifactDelivery: 'oss' }))
  assert.notEqual(f.prepare().status, 0)
  writeFileSync(infoPath, JSON.stringify({ ...info, artifactOrigin: 'https://apps.example.invalid', artifactDelivery: 'oss' }))
  writeFileSync(join(f.server, 'shared/api.env'), 'APP_ARTIFACT_ORIGIN=https://apps.example.invalid\nAPP_ARTIFACT_DELIVERY=local\n')
  assert.notEqual(f.prepare().status, 0)
  writeFileSync(join(f.server, 'shared/api.env'), 'APP_ARTIFACT_ORIGIN=https://apps.example.invalid\nAPP_ARTIFACT_DELIVERY=oss\n')
  assert.equal(f.prepare().status, 0)
})

function sourceFixture(t) {
  const f = fixture(t)
  const source = join(f.server, 'source')
  const trace = join(f.root, 'source.jsonl')
  mkdirSync(join(source, 'deploy/pm2'), { recursive: true })
  mkdirSync(join(source, 'scripts'))
  copyFileSync(join(workspace, 'deploy/pm2/deploy-source.mjs'), join(source, 'deploy/pm2/deploy-source.mjs'))
  writeFileSync(join(source, 'package.json'), '{"type":"module"}\n')
  const record = `require('node:fs').appendFileSync(process.env.SOURCE_TRACE,JSON.stringify(process.argv.slice(2))+'\\n');`
  writeFileSync(join(f.root, 'bin/pnpm'), `#!/usr/bin/env node\n${record}if(process.argv[2]==='install'&&process.env.CI!=='true')process.exit(9);if(process.env.FAIL_SOURCE_INSTALL==='1')process.exit(7);\n`, { mode: 0o755 })
  writeFileSync(join(f.root, 'bin/pm2'), `#!/usr/bin/env node\n${record}\n`, { mode: 0o755 })
  writeFileSync(join(source, 'scripts/pack-api-pm2.mjs'), `
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
appendFileSync(process.env.SOURCE_TRACE,JSON.stringify(['pack'])+'\\n')
const output=process.argv[3],payload=join(output,'payload')
mkdirSync(join(payload,'control'),{recursive:true})
writeFileSync(join(payload,'control/start-release.mjs'),"import fs from 'node:fs';fs.appendFileSync(process.env.SOURCE_TRACE,JSON.stringify(['start',...process.argv.slice(2)])+'\\\\n')")
execFileSync('tar',['-czf',join(output,'runtime.tar.gz'),'-C',payload,'.'])
`)
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  git(['init', '--quiet'])
  git(['add', '.'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'])
  const preload = join(f.root, 'linux-fixture.mjs')
  writeFileSync(preload, 'Object.defineProperty(process, \'platform\', { value: \'linux\' })\n')
  const deploy = (args = [], extra = {}) => spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(source, 'deploy/pm2/deploy-source.mjs'), ...args], {
    env: { ...f.env, PM2_DEPLOY_ROOT: f.server, SOURCE_TRACE: trace, ...extra },
    encoding: 'utf8',
  })
  return { ...f, source, deploy, calls: () => readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) }
}

test('upload verifies/extracts a new directory without modifying shared data or current version', (t) => {
  const f = fixture(t)
  const result = f.upload()
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.ok(existsSync(join(f.uploaded, 'api/dist/server.js')))
  assert.equal(existsSync(join(f.server, 'incoming', releaseId)), false)
  assert.equal(existsSync(join(f.uploaded, 'api/.env')), false)
  assert.equal(existsSync(join(f.server, 'shared/logs')), false)
  assert.match(readFileSync(join(f.server, 'shared/api.env'), 'utf8'), /fixture-secret/)
  const calls = readFileSync(f.env.UPLOAD_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  for (const call of calls.filter((call) => call.tool === 'ssh' || call.tool === 'scp')) {
    assert.ok(call.args.includes('StrictHostKeyChecking=yes'))
    assert.ok(call.args.includes('UserKnownHostsFile=' + f.env.PM2_SSH_KNOWN_HOSTS_FILE))
    assert.ok(call.args.includes('GlobalKnownHostsFile=/dev/null'))
  }
  assert.equal(calls.some((call) => call.args.some((arg) => arg === 'pm2' || arg === 'dist/init-db.js')), false)
})

test('local checksum failure prevents any SSH connection', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.packageDir, 'runtime.tar.gz'), 'corrupt')
  assert.notEqual(f.upload().status, 0)
  assert.equal(existsSync(f.env.UPLOAD_LOG), false)
})

test('password authentication pins the host without a login key and does not expose the password', (t) => {
  const f = fixture(t)
  const result = f.upload({ PM2_SSH_PASSWORD: 'fixture password $!#', PM2_SSH_KEY_FILE: '' })
  assert.equal(result.status, 0, result.stderr + result.stdout)
  const text = readFileSync(f.env.UPLOAD_LOG, 'utf8')
  const calls = text.trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(calls.filter((call) => call.tool === 'sshpass').length, 4)
  for (const call of calls.filter((call) => call.tool === 'ssh' || call.tool === 'scp')) {
    assert.ok(call.args.includes('BatchMode=no'))
    assert.ok(call.args.includes('PubkeyAuthentication=no'))
    assert.ok(call.args.includes('StrictHostKeyChecking=yes'))
    assert.ok(call.args.includes('UserKnownHostsFile=' + f.env.PM2_SSH_KNOWN_HOSTS_FILE))
    assert.ok(call.args.includes('GlobalKnownHostsFile=/dev/null'))
    assert.equal(call.args.includes('-i'), false)
  }
  assert.equal((text + result.stdout + result.stderr).includes('fixture password $!#'), false)
})

test('missing or mismatched server public keys fail before sending login credentials', (t) => {
  const f = fixture(t)
  assert.notEqual(f.upload({ PM2_SSH_KNOWN_HOSTS_FILE: '' }).status, 0)
  writeFileSync(f.env.PM2_SSH_KNOWN_HOSTS_FILE, 'other.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n')
  assert.notEqual(f.upload({ PM2_SSH_PASSWORD: 'fixture password $!#' }).status, 0)
  assert.equal(existsSync(f.env.UPLOAD_LOG), false)
})

test('missing login credentials and password line breaks fail before connecting', (t) => {
  const f = fixture(t)
  assert.notEqual(f.upload({ PM2_SSH_PASSWORD: '', PM2_SSH_KEY_FILE: '' }).status, 0)
  assert.notEqual(f.upload({ PM2_SSH_PASSWORD: 'invalid\npassword', PM2_SSH_KEY_FILE: '' }).status, 0)
  assert.equal(existsSync(f.env.UPLOAD_LOG), false)
})

test('server checksum failure never publishes an extracted release', (t) => {
  const f = fixture(t)
  assert.notEqual(f.upload({ CORRUPT_REMOTE: '1' }).status, 0)
  assert.equal(existsSync(f.uploaded), false)
  assert.equal(existsSync(join(f.server, 'incoming', releaseId)), false)
})

test('existing version directories are never overwritten', (t) => {
  const f = fixture(t)
  mkdirSync(f.uploaded, { recursive: true })
  writeFileSync(join(f.uploaded, 'marker'), 'preserve')
  assert.notEqual(f.upload().status, 0)
  assert.equal(readFileSync(join(f.uploaded, 'marker'), 'utf8'), 'preserve')
})

test('unsafe upload paths fail before SSH', (t) => {
  const f = fixture(t)
  assert.notEqual(f.upload({ PM2_UPLOAD_DIR: '/tmp/../escape' }).status, 0)
  assert.notEqual(f.upload({ PM2_UPLOAD_DIR: '/tmp/unsafe path' }).status, 0)
  assert.equal(existsSync(f.env.UPLOAD_LOG), false)
})

test('invalid startup options fail before any SSH connection', (t) => {
  const f = fixture(t)
  for (const options of [
    { PM2_START_SERVICES: 'invalid' },
    { PM2_INIT_ADMIN: 'invalid' },
    { PM2_START_SERVICES: 'false', PM2_INIT_ADMIN: 'true' },
  ]) {
    assert.notEqual(f.upload(options).status, 0)
  }
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

test('startup stops both writers before initialization, replaces absolute paths and saves only a healthy release', async (t) => {
  const f = startupFixture(t)
  await f.start()
  const initialization = f.commands.findIndex((command) => command[1]?.endsWith('/dist/init-db.js') && !command.includes('--check'))
  const preflight = f.commands.findIndex((command) => command.includes('--check') && command[1]?.endsWith('/dist/init-db.js'))
  assert.ok(preflight >= 0 && preflight < f.commands.findIndex((command) => command[0] === 'pm2' && command[1] === 'stop'))
  assert.ok(initialization > f.commands.findIndex((command) => command[0] === 'pm2' && command[1] === 'stop' && command[2] === 't-box-api'))
  assert.ok(initialization > f.commands.findIndex((command) => command[0] === 'pm2' && command[1] === 'stop' && command[2] === 't-box-worker'))
  assert.ok(f.commands.findIndex((command) => command[1] === 'start') > initialization)
  assert.equal(f.commands.some((command) => command[1]?.endsWith('/dist/admin/bootstrap.js')), false)
  assert.deepEqual(f.commands.at(-1), ['pm2', 'save'])
  assert.equal(f.healthRequests(), 3)
  assert.equal(realpathSync(join(f.server, 'current')), realpathSync(f.uploaded))
  assert.equal(existsSync(join(f.server, '.pm2-deploy.lock')), false)
  assert.equal(f.processes().find((entry) => entry.name === 'other-service').pm2_env.status, 'online')
})

test('incompatible database preflight fails before stopping either writer', async (t) => {
  const f = startupFixture(t, { preflightFails: true })
  await assert.rejects(f.start(), /fixture preflight failure/)
  assert.equal(f.commands.some((command) => command[0] === 'pm2' && ['stop', 'delete', 'start', 'save'].includes(command[1])), false)
  assert.ok(f.processes().every((entry) => entry.pm2_env.status === 'online'))
  assert.equal(existsSync(join(f.server, '.pm2-deploy.lock')), false)
})

test('administrator initialization requires an explicit first-install option', async (t) => {
  const f = startupFixture(t)
  await f.start({ initializeAdmin: true })
  const initialization = f.commands.findIndex((command) => command[1]?.endsWith('/dist/init-db.js') && !command.includes('--check'))
  const admin = f.commands.findIndex((command) => command[1]?.endsWith('/dist/admin/bootstrap.js'))
  assert.ok(admin > initialization)
  assert.ok(admin < f.commands.findIndex((command) => command[1] === 'start'))
})

test('initialization failure leaves writers stopped without starting, saving or changing current', async (t) => {
  const f = startupFixture(t, { initializationFails: true })
  await assert.rejects(f.start(), /fixture initialization failure/)
  assert.equal(f.commands.some((command) => ['start', 'save', 'delete'].includes(command[1])), false)
  assert.ok(f.processes().filter((entry) => entry.name.startsWith('t-box-')).every((entry) => entry.pm2_env.status === 'stopped'))
  assert.equal(existsSync(join(f.server, 'current')), false) // The original fixture link points at its old, absent release.
  assert.equal(existsSync(join(f.server, '.pm2-deploy.lock')), false)
})

test('unhealthy dependencies, stale script paths and restart loops cannot publish a successful deployment', async (t) => {
  for (const options of [{ healthy: false }, { redisDown: true }, { wrongScript: true }, { restarts: true }]) {
    const f = startupFixture(t, options)
    await assert.rejects(f.start(), /health checks/)
    assert.equal(f.commands.some((command) => command[1] === 'save'), false)
    assert.ok(f.processes().filter((entry) => entry.name.startsWith('t-box-')).every((entry) => entry.pm2_env.status === 'stopped'))
    assert.equal(existsSync(join(f.server, '.pm2-deploy.lock')), false)
  }
})

test('missing configuration and a deployment lock leave the running version untouched', async (t) => {
  const f = startupFixture(t)
  rmSync(join(f.server, 'shared/api.env'))
  await assert.rejects(f.start(), /ENOENT/)
  assert.deepEqual(f.commands, [])
  writeFileSync(join(f.server, 'shared/api.env'), 'APP_ARTIFACT_ORIGIN=https://apps.example.invalid\n')
  mkdirSync(join(f.server, '.pm2-deploy.lock'))
  await assert.rejects(f.start(), /Another deployment/)
  assert.deepEqual(f.commands, [])
  assert.ok(existsSync(join(f.server, '.pm2-deploy.lock')))
})

test('source deployment builds with compilers, extracts a separate release and forwards first-install mode', (t) => {
  const f = sourceFixture(t)
  const result = f.deploy(['--init-admin'], { NODE_ENV: 'production' })
  assert.equal(result.status, 0, result.stderr)
  const calls = f.calls()
  assert.ok(calls.some((args) => args.join(' ') === 'install --frozen-lockfile --prod=false'))
  assert.ok(calls.findIndex((args) => args[0] === 'pack') < calls.findIndex((args) => args[0] === 'start'))
  assert.deepEqual(calls.at(-1), ['start', '--init-admin'])
  assert.equal(existsSync(join(f.server, '.pm2-build.lock')), false)
  assert.match(readFileSync(join(f.server, 'shared/api.env'), 'utf8'), /fixture-secret/)
})

test('failed dependency installation cannot start PM2 or leave a source-build lock', (t) => {
  const f = sourceFixture(t)
  const result = f.deploy([], { FAIL_SOURCE_INSTALL: '1' })
  assert.notEqual(result.status, 0)
  assert.equal(f.calls().some((args) => ['pack', 'start'].includes(args[0])), false)
  assert.equal(existsSync(join(f.server, '.pm2-build.lock')), false)
})

test('dirty source and missing production configuration fail before installing or stopping services', (t) => {
  const f = sourceFixture(t)
  writeFileSync(join(f.source, 'package.json'), '{"changed":true}\n')
  assert.notEqual(f.deploy().status, 0)
  assert.equal(f.calls().some((args) => ['install', 'start', 'stop'].includes(args[0])), false)
  rmSync(join(f.server, 'shared/api.env'))
  assert.notEqual(f.deploy().status, 0)
  assert.equal(existsSync(join(f.server, '.pm2-build.lock')), false)
})
