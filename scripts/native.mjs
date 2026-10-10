#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, networkInterfaces } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [command, ...arguments_] = process.argv.slice(2).filter((value) => value !== '--')
const usage = `Usage: node scripts/native.mjs <sync|open|run|dev> [ios|android] [--url http://LAN-IP:5173] [--run]
  sync          Build fresh web assets, then copy them to the native projects.
  open PLATFORM Build and sync bundled assets, then open Xcode or Android Studio.
  run PLATFORM  Build and sync bundled assets, then run on a device/emulator.
  dev PLATFORM  Sync a live reload URL, then open the native IDE (or use --run).

Start pnpm dev in another terminal before native:dev. Both devices must share a network.
Only dev accepts --url and --run. native:sync always removes the live reload URL.`

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!command || command === '--help' || command === '-h') {
  console.log(usage)
  process.exit(0)
}
if (!['sync', 'open', 'run', 'dev'].includes(command)) {
  fail(usage)
}

let platform
let requestedUrl
let runInDevice = false
for (let index = 0; index < arguments_.length; index += 1) {
  const value = arguments_[index]
  if (['ios', 'android'].includes(value) && !platform) {
    platform = value
  } else if (value === '--url') {
    requestedUrl = arguments_[++index] || fail('--url requires a URL.')
  } else if (value === '--run') {
    runInDevice = true
  } else {
    fail(`Unknown argument: ${value}\n${usage}`)
  }
}
if (command !== 'sync' && !platform) {
  fail(`Choose ios or android.\n${usage}`)
}
if (command !== 'dev' && (requestedUrl || runInDevice)) {
  fail('--url and --run are only available for native:dev.')
}

const environment = { ...process.env }
// Never inherit a developer's live reload URL into a bundled build or sync.
delete environment.CAP_LIVE_RELOAD_URL
delete environment.CAP_SERVER_URL

function execute(args, env = environment) {
  const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: root,
    env,
    stdio: 'inherit',
  })
  if (result.error) {
    fail(result.error.message)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function cap(...args) {
  execute(['--filter', '@t-box/capacitor', 'exec', 'cap', ...args])
}

execute(['--filter', '@t-box/capacitor', 'sync:version'])
execute(['--filter', '@t-box/capacitor', 'sync:wechat'])
if (command !== 'dev' || !existsSync(resolve(root, 'capacitor/www/index.html'))) {
  execute(['--filter', '@t-box/capacitor', 'build:web'])
  execute(['--filter', '@t-box/capacitor', 'copy:web'])
}

if (command === 'dev') {
  const interfaces = Object.entries(networkInterfaces()).sort(([left], [right]) =>
    Number(!/^(?:en|eth|wlan|Wi-Fi)/.test(left)) - Number(!/^(?:en|eth|wlan|Wi-Fi)/.test(right)),
  )
  const addresses = interfaces.flatMap(([, addresses]) => addresses ?? [])
  const address = addresses.find((entry) => entry.family === 'IPv4' && !entry.internal)?.address
  const url = requestedUrl ?? process.env.CAP_LIVE_RELOAD_URL ?? process.env.CAP_SERVER_URL ?? (address ? `http://${address}:5173` : undefined)
  if (!url) {
    fail('No LAN IPv4 address found. Supply --url http://YOUR-IP:5173.')
  }
  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    fail('The live reload URL must be an absolute HTTP(S) URL.')
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    fail('The live reload URL must use HTTP(S) and must not include credentials.')
  }
  environment.CAP_LIVE_RELOAD_URL = parsedUrl.toString()
  console.log(`Live reload: ${environment.CAP_LIVE_RELOAD_URL}`)
  console.log('Keep pnpm dev running. Use pnpm native:sync before packaging bundled assets.')
}

if (platform === 'android') {
  // Use the local SDK when installed in the standard macOS location. These
  // values are scoped to child processes; no shell or system settings change.
  const localSdk = resolve(homedir(), 'Library/Android/sdk')
  if (!environment.ANDROID_HOME && !environment.ANDROID_SDK_ROOT && existsSync(localSdk)) {
    environment.ANDROID_HOME = localSdk
  }
  if (command === 'run' || runInDevice) {
    const java = environment.JAVA_HOME ? resolve(environment.JAVA_HOME, 'bin/java') : 'java'
    const probe = spawnSync(java, ['-version'], { env: environment, encoding: 'utf8' })
    const major = Number(`${probe.stderr ?? ''}${probe.stdout ?? ''}`.match(/version "(\d+)/)?.[1])
    const studioJava = '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
    if ((probe.status !== 0 || major < 21) && existsSync(resolve(studioJava, 'bin/java'))) {
      const studioProbe = spawnSync(resolve(studioJava, 'bin/java'), ['-version'], { encoding: 'utf8' })
      if (studioProbe.status === 0) {
        environment.JAVA_HOME = studioJava
        console.log('Using Android Studio’s bundled Java for this command.')
      }
    }
  }
}

cap('sync', ...(platform ? [platform] : []))
if (command === 'open' || (command === 'dev' && !runInDevice)) {
  cap('open', platform)
}
if (command === 'run' || (command === 'dev' && runInDevice)) {
  cap('run', platform, '--no-sync')
}
