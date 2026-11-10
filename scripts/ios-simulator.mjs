import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export function simulatorApplication(developer, exists = existsSync) {
  const paths = [
    resolve(developer, '../Applications/DeviceHub.app'),
    resolve(developer, 'Applications/Simulator.app'),
    resolve(developer, '../Applications/Simulator.app'),
  ]
  const app = paths.find(exists)
  if (!app) {
    throw new Error('找不到 Device Hub 或 Simulator，请检查当前选择的 Xcode 是否完整。')
  }
  return app
}

// native-run 2.x hardcodes Simulator.app, which Xcode 27 replaced with Device Hub.
// Use Apple's CLI for an explicit simulator; physical devices still use Capacitor.
export function runIosSimulator(root, target) {
  if (process.platform !== 'darwin' || !target) {
    return false
  }
  const project = resolve(root, 'capacitor/ios/App')
  const run = (command, args, capture = false) => {
    const result = spawnSync(command, args, { cwd: project, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' })
    if (result.error || result.status !== 0) {
      throw new Error(result.error?.message || result.stderr?.trim() || `${command} ${args.join(' ')} 失败（${result.status}）。`)
    }
    return result.stdout?.trim()
  }
  const inventory = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], true))
  const device = Object.entries(inventory.devices).filter(([runtime]) => runtime.includes('.iOS-')).flatMap(([, devices]) => devices).find((device) => device.udid === target && device.isAvailable)
  if (!device) {
    return false
  }
  const developer = process.env.DEVELOPER_DIR || run('xcode-select', ['-p'], true)
  const simulator = simulatorApplication(developer)
  const derived = resolve(project, '../DerivedData', target)
  console.info(`编译 iOS 模拟器应用：${device.name}`)
  run('xcrun', ['xcodebuild', '-workspace', 'App.xcworkspace', '-scheme', 'App', '-configuration', 'Debug', '-destination', `id=${target}`, '-derivedDataPath', derived, '-quiet'])
  if (device.state !== 'Booted') {
    run('xcrun', ['simctl', 'boot', target])
  }
  run('xcrun', ['simctl', 'bootstatus', target, '-b'])
  const app = resolve(derived, 'Build/Products/Debug-iphonesimulator/App.app')
  const bundleId = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', resolve(app, 'Info.plist')], true)
  run('xcrun', ['simctl', 'install', target, app])
  run('open', ['-a', simulator, '--args', '-CurrentDeviceUDID', target])
  run('xcrun', ['simctl', 'launch', '--terminate-running-process', target, bundleId])
  return true
}
