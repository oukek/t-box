import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const plugin = resolve(root, 'capacitor-plugins/capacitor-app-resources')
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 90_000 })
  assert.equal(result.status, 0, `${result.error?.message || ''}\n${result.stdout}\n${result.stderr}`)
}
test('Android resource store and isolated loopback server pass real JVM integrity/offline/rollback checks', async (t) => {
  const androidJava = '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
  const taskJava = process.env.JAVA_HOME || (existsSync(androidJava) ? androidJava : undefined)
  const javac = taskJava ? resolve(taskJava, 'bin/javac') : 'javac'
  const available = spawnSync(javac, ['-version'], { encoding: 'utf8' })
  if (available.status !== 0 || !/(?:1[7-9]|2\d)\./.test(available.stdout + available.stderr)) {
    t.skip('JDK 17+ is required for native JVM acceptance')
    return
  }
  const output = await mkdtemp(resolve(tmpdir(), 'tbox-native-resources-'))
  try {
    const source = resolve(plugin, 'android/src/main/java/com/tbox/plugins/appresources')
    run(javac, ['-d', output, resolve(source, 'PackageStore.java'), resolve(source, 'LoopbackServer.java'), resolve(plugin, 'test/PackageStoreTest.java')])
    run(taskJava ? resolve(taskJava, 'bin/java') : 'java', ['-cp', output, 'com.tbox.plugins.appresources.PackageStoreTest'])
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
test('iOS resource store and isolated loopback server pass actual Swift file/network checks', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Apple CryptoKit/Network runtime requires macOS')
    return
  }
  const output = await mkdtemp(resolve(tmpdir(), 'tbox-swift-resources-'))
  try {
    const executable = resolve(output, 'resources-test')
    run('swiftc', ['-swift-version', '5', resolve(plugin, 'ios/VerifiedPackageStore.swift'), resolve(plugin, 'ios/ResourceLoopbackServer.swift'), resolve(plugin, 'test/PackageStoreTest.swift'), '-o', executable])
    run(executable, [])
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('release HTTP exception stays loopback-only and the debug overlay preserves LAN hot reload', async () => {
  const { readFile } = await import('node:fs/promises')
  const release = await readFile(resolve(root, 'capacitor/android/app/src/main/res/xml/network_security_config.xml'), 'utf8')
  const debug = await readFile(resolve(root, 'capacitor/android/app/src/debug/res/xml/network_security_config.xml'), 'utf8')
  assert.match(release, /base-config cleartextTrafficPermitted="false"/)
  assert.match(release, /<domain>127\.0\.0\.1<\/domain>/)
  assert.match(debug, /base-config cleartextTrafficPermitted="true"/)
})
