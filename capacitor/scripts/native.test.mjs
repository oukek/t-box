import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tbox-native-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, value) => {
    const target = join(root, path)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, value)
  }
  cpSync(new URL('./', import.meta.url), join(root, 'capacitor/scripts'), { recursive: true })
  put('capacitor/package.json', JSON.stringify({ version: '2.3.4' }))
  put('capacitor/android/app/build.gradle', 'versionCode 42\nversionName "1.0"\n')
  put('capacitor/ios/App/App.xcodeproj/project.pbxproj', 'CURRENT_PROJECT_VERSION = 42;\nMARKETING_VERSION = 1.0;\nCURRENT_PROJECT_VERSION = 42;\nMARKETING_VERSION = 1.0;\n')
  const read = (path) => readFileSync(join(root, path), 'utf8')
  const run = (script, overrides = {}) => {
    const env = { ...process.env }
    delete env.APP_BUILD_NUMBER
    delete env.GITHUB_RUN_NUMBER
    return spawnSync(process.execPath, [join(root, 'capacitor/scripts', script)], {
      env: { ...env, ...overrides },
      encoding: 'utf8',
    })
  }
  return { root, put, read, run }
}

test('version sync preserves local build numbers and updates all iOS configurations', (t) => {
  const f = fixture(t)
  assert.equal(f.run('sync-native-version.mjs').status, 0)
  assert.match(f.read('capacitor/android/app/build.gradle'), /versionCode 42\nversionName "2.3.4"/)
  const ios = f.read('capacitor/ios/App/App.xcodeproj/project.pbxproj')
  assert.equal(ios.match(/MARKETING_VERSION = 2.3.4;/g).length, 2)
  assert.equal(ios.match(/CURRENT_PROJECT_VERSION = 42;/g).length, 2)
})

test('explicit build number wins over CI; invalid inputs leave both native files untouched', (t) => {
  const f = fixture(t)
  assert.equal(f.run('sync-native-version.mjs', { APP_BUILD_NUMBER: '123', GITHUB_RUN_NUMBER: '99' }).status, 0)
  assert.match(f.read('capacitor/android/app/build.gradle'), /versionCode 123/)
  assert.match(f.read('capacitor/ios/App/App.xcodeproj/project.pbxproj'), /CURRENT_PROJECT_VERSION = 123;/)
  assert.equal(f.run('sync-native-version.mjs', { GITHUB_RUN_NUMBER: '124' }).status, 0)
  const android = f.read('capacitor/android/app/build.gradle')
  const ios = f.read('capacitor/ios/App/App.xcodeproj/project.pbxproj')
  for (const number of ['0', '-1', '1.5', '2100000001', 'abc', '']) {
    assert.notEqual(f.run('sync-native-version.mjs', { APP_BUILD_NUMBER: number }).status, 0)
    assert.equal(f.read('capacitor/android/app/build.gradle'), android)
    assert.equal(f.read('capacitor/ios/App/App.xcodeproj/project.pbxproj'), ios)
  }
  f.put('capacitor/package.json', JSON.stringify({ version: '1.0.0-beta' }))
  assert.notEqual(f.run('sync-native-version.mjs').status, 0)
  assert.equal(f.read('capacitor/android/app/build.gradle'), android)
  assert.equal(f.read('capacitor/ios/App/App.xcodeproj/project.pbxproj'), ios)
})

test('copy validates source before replacing existing assets and removes stale chunks', (t) => {
  const f = fixture(t)
  f.put('capacitor/www/index.html', 'old')
  f.put('capacitor/www/assets/stale.js', 'stale')
  assert.notEqual(f.run('copy-web-assets.mjs').status, 0)
  assert.equal(f.read('capacitor/www/index.html'), 'old')
  f.put('app/dist/index.html', 'fresh')
  f.put('app/dist/assets/new.js', 'new')
  assert.equal(f.run('copy-web-assets.mjs').status, 0)
  assert.equal(f.read('capacitor/www/index.html'), 'fresh')
  assert.equal(f.read('capacitor/www/assets/new.js'), 'new')
  assert.equal(existsSync(join(f.root, 'capacitor/www/assets/stale.js')), false)
})

test('bundled sync clears both live reload variables; dev keeps an explicit URL', {
  skip: process.platform === 'win32',
}, (t) => {
  const f = fixture(t)
  f.put('scripts/native.mjs', readFileSync(new URL('../../scripts/native.mjs', import.meta.url), 'utf8'))
  f.put('capacitor/www/index.html', 'cached')
  // Replace only the pnpm child process to inspect the orchestration without opening IDEs.
  f.put('bin/pnpm', `#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.TBOX_TEST_COMMAND_LOG, JSON.stringify({ args: process.argv.slice(2),
  live: process.env.CAP_LIVE_RELOAD_URL, server: process.env.CAP_SERVER_URL }) + '\\n');
`)
  chmodSync(join(f.root, 'bin/pnpm'), 0o755)
  const log = join(f.root, 'commands.log')
  const run = (...args) => spawnSync(process.execPath, [join(f.root, 'scripts/native.mjs'), ...args], {
    env: { ...process.env, PATH: `${join(f.root, 'bin')}${delimiter}${process.env.PATH}`, CAP_LIVE_RELOAD_URL: 'http://localhost:1111', CAP_SERVER_URL: 'http://localhost:2222', TBOX_TEST_COMMAND_LOG: log },
    encoding: 'utf8',
  })
  assert.equal(run('sync').status, 0)
  const commands = f.read('commands.log').trim().split('\n').map(JSON.parse)
  assert.equal(commands.length, 5)
  assert.equal(commands[2].args.at(-1), 'build:web')
  assert.equal(commands[3].args.at(-1), 'copy:web')
  assert.deepEqual(commands[4].args.slice(-2), ['cap', 'sync'])
  for (const command of commands) {
    assert.equal(command.live, undefined)
    assert.equal(command.server, undefined)
  }
  f.put('commands.log', '')
  assert.equal(run('dev', 'ios', '--url', 'http://192.168.1.10:5173').status, 0)
  const dev = f.read('commands.log').trim().split('\n').map(JSON.parse)
  assert.equal(dev.length, 4)
  assert.deepEqual(dev[2].args.slice(-3), ['cap', 'sync', 'ios'])
  assert.equal(dev[2].live, 'http://192.168.1.10:5173/')
  assert.equal(dev[2].server, undefined)
})
