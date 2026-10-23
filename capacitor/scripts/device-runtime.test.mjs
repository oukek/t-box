import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { navigationAssociation, navigationInfo, validateNavigationConfig } from './navigation-config.mjs'

test('navigation configuration validates origins and preserves payment URL schemes and AASA paths', () => {
  assert.deepEqual(validateNavigationConfig({ universalLinkOrigin: '', iosTeamId: '' }), { universalLinkOrigin: '', iosTeamId: '' })
  const config = validateNavigationConfig({ universalLinkOrigin: 'https://tbox.example.com', iosTeamId: 'ABCDE12345' })
  const info = navigationInfo({ CFBundleURLTypes: [{ CFBundleURLName: 'com.tbox.wechatpay', CFBundleURLSchemes: ['wx123'] }] }, config)
  assert.equal(info.CFBundleURLTypes.length, 2)
  assert.equal(navigationInfo(info, config).CFBundleURLTypes.length, 2)
  const association = navigationAssociation(config, 'com.tbox.app', { applinks: { details: [{ appID: 'ABCDE12345.com.tbox.app', paths: ['/wechat/*'] }] } })
  assert.deepEqual(association.applinks.details[0].paths, ['/wechat/*', '/open/*'])
  for (const origin of ['http://tbox.example.com', 'https://tbox.example.com/path', 'https://tbox.example.com/?token=x', 'https://user:password@tbox.example.com']) {
    assert.throws(() => validateNavigationConfig({ universalLinkOrigin: origin, iosTeamId: 'ABCDE12345' }))
  }
})
test('actual Swift runtime preserves native requests and rejects iframe/plugin bypasses', { timeout: 90000 }, async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Apple Foundation/CryptoKit/Security required')
    return
  }
  const root = resolve(import.meta.dirname, '../..')
  const directory = await mkdtemp(resolve(tmpdir(), 'tbox-native-device-test-'))
  try {
    await copyFile(resolve(root, 'capacitor-plugins/capacitor-device-runtime/test/DeviceRuntimeTest.swift'), resolve(directory, 'main.swift'))
    const executable = resolve(directory, 'checks')
    const compilation = spawnSync('xcrun', ['--sdk', 'macosx', 'swiftc', resolve(root, 'capacitor-plugins/capacitor-device-runtime/ios/DeviceStore.swift'), resolve(root, 'capacitor-plugins/capacitor-device-runtime/ios/ShortcutParameters.swift'), resolve(root, 'capacitor/ios/App/App/NativeBridgePolicy.swift'), resolve(directory, 'main.swift'), '-o', executable], { encoding: 'utf8', timeout: 60000 })
    assert.equal(compilation.status, 0, compilation.stderr)
    const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 15000 })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /iframe isolation passed/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
