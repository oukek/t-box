import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { selectSimulator } from './dev-ios.mjs'
import { simulatorApplication } from './ios-simulator.mjs'

test('simulator UI follows selected Xcode and supports Device Hub and legacy Simulator layouts', () => {
  const developer = '/Some Xcode.app/Contents/Developer'
  const hub = '/Some Xcode.app/Contents/Applications/DeviceHub.app'
  const legacy = '/Some Xcode.app/Contents/Developer/Applications/Simulator.app'
  assert.equal(simulatorApplication(developer, (path) => path === hub), hub)
  assert.equal(simulatorApplication(developer, (path) => path === legacy), legacy)
  assert.throws(() => simulatorApplication(developer, () => false), /找不到/)
})

test('iOS launcher selects a running simulator, otherwise a recent iPhone, and honors explicit targets', () => {
  const data = { devices: {
    'runtime.iOS-27-0': [
      { udid: 'phone', name: 'iPhone', isAvailable: true, state: 'Shutdown', lastUsedAt: '2026-01-01' },
      { udid: 'new', name: 'iPhone new', isAvailable: true, state: 'Shutdown' },
      { udid: 'pad', name: 'iPad', isAvailable: true, state: 'Booted' },
      { udid: 'broken', name: 'iPhone', isAvailable: false, state: 'Booted' },
    ],
    'runtime.tvOS-27-0': [{ udid: 'tv', name: 'TV', isAvailable: true, state: 'Booted' }],
  } }
  assert.equal(selectSimulator(data).udid, 'pad')
  data.devices['runtime.iOS-27-0'][2].state = 'Shutdown'
  assert.equal(selectSimulator(data).udid, 'phone')
  assert.equal(selectSimulator(data, 'new').udid, 'new')
  assert.throws(() => selectSimulator(data, 'broken'), /找不到/)
  assert.throws(() => selectSimulator({ devices: {} }), /没有可用/)
})

async function fixture(t, { failServices = false, failNative = false, existing = false, bundled = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tbox-dev-ios-'))
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'bin'))
  for (const name of ['dev-ios.mjs', 'dev-readiness.mjs']) {
    copyFileSync(new URL(name, import.meta.url), join(root, 'scripts', name))
  }
  const log = join(root, 'events')
  const server = createServer((_req, res) => res.end(JSON.stringify({ data: { dependencies: { mysql: 'up' } } })))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  if (!existing) {
    await new Promise((resolve) => server.close(resolve))
  }
  writeFileSync(join(root, 'bin/xcrun'), `#!${process.execPath}
console.log(JSON.stringify({devices:{'runtime.iOS-27-0':[{udid:'test-phone',name:'iPhone test',state:'Shutdown',isAvailable:true}]}}))
`, { mode: 0o755 })
  writeFileSync(join(root, 'bin/pnpm'), `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
appendFileSync(process.env.TBOX_IOS_TEST_LOG, 'services\\n');
if (${failServices}) process.exit(9);
spawn(process.execPath, ['-e', "require('node:fs').appendFileSync(process.env.TBOX_IOS_TEST_LOG, 'pid:' + process.pid + String.fromCharCode(10));setInterval(() => {}, 1000)"]);
let requests=0;
require('node:http').createServer((req,res)=>{
 requests++;
 res.statusCode=requests<3?503:200;
 if(requests===3)appendFileSync(process.env.TBOX_IOS_TEST_LOG,'ready\\n');
 res.end(JSON.stringify({data:{dependencies:{mysql:requests<3?'down':'up'}}}));
}).listen(${port}, '127.0.0.1');
`, { mode: 0o755 })
  writeFileSync(join(root, 'scripts/native.mjs'), `
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.TBOX_IOS_TEST_LOG, 'native:' + JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(${failNative ? 8 : 0});
`)
  let output = ''
  const child = spawn(process.execPath, [join(root, 'scripts/dev-ios.mjs'), '--url', `http://127.0.0.1:${port}`, ...(existing ? ['--existing'] : []), ...(bundled ? ['--bundled'] : [])], {
    env: { ...process.env, PATH: join(root, 'bin') + delimiter + process.env.PATH, TBOX_IOS_TEST_LOG: log },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (data) => {
    output += data
  })
  child.stderr.on('data', (data) => {
    output += data
  })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const events = () => {
    try {
      return readFileSync(log, 'utf8')
    } catch {
      return ''
    }
  }
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
    }
    await exited
    for (const match of events().matchAll(/pid:(\d+)/g)) {
      try {
        process.kill(Number(match[1]), 'SIGKILL')
      } catch { /* already stopped */ }
    }
    await new Promise((resolve) => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  })
  return { child, exited, events, output: () => output, server }
}

test('one command waits for healthy services, launches a chosen simulator, keeps HMR running and cleans descendants on Ctrl+C', { skip: process.platform !== 'darwin', timeout: 15000 }, async (t) => {
  const f = await fixture(t)
  for (let count = 0; count < 120 && !f.output().includes('App 已启动'); count++) {
    await delay(50)
  }
  assert.match(f.output(), /App 已启动/)
  assert.match(f.events(), /ready\nnative:/)
  assert.match(f.events(), /"--target","test-phone"/)
  assert.equal(f.child.exitCode, null)
  const pid = Number(f.events().match(/pid:(\d+)/)[1])
  f.child.kill('SIGINT')
  await f.exited
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('failed services never launch iOS, and failed native builds stop owned services', { skip: process.platform !== 'darwin', timeout: 15000 }, async (t) => {
  for (const mode of ['failServices', 'failNative']) {
    const f = await fixture(t, { [mode]: true })
    assert.equal(await f.exited, 1, f.output())
    if (mode === 'failServices') {
      assert.doesNotMatch(f.events(), /native:/)
    } else {
      assert.match(f.events(), /native:/)
      const pid = Number(f.events().match(/pid:(\d+)/)[1])
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    }
  }
})

test('existing development services are reused and never stopped by the iOS launcher', { skip: process.platform !== 'darwin', timeout: 15000 }, async (t) => {
  const f = await fixture(t, { existing: true })
  for (let count = 0; count < 120 && !f.output().includes('App 已启动'); count++) {
    await delay(50)
  }
  assert.match(f.output(), /App 已启动/)
  assert.doesNotMatch(f.events(), /services/)
  await delay(300)
  assert.equal(f.child.exitCode, null)
  f.child.kill('SIGINT')
  await f.exited
  assert.equal((await fetch(`http://127.0.0.1:${f.server.address().port}`)).status, 200)
})

test('bundled iOS preview launches local assets without a live reload URL', { skip: process.platform !== 'darwin', timeout: 15000 }, async (t) => {
  const f = await fixture(t, { existing: true, bundled: true })
  for (let count = 0; count < 120 && !f.output().includes('App 已启动'); count++) {
    await delay(50)
  }
  assert.match(f.output(), /内置资源/)
  const args = JSON.parse(f.events().split('native:')[1].split('\n')[0])
  assert.deepEqual(args, ['run', 'ios', '--target', 'test-phone'])
  f.child.kill('SIGINT')
  await f.exited
})
