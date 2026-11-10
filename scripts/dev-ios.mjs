import { execFile, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { waitForApi } from './dev-readiness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const usage = `Usage: pnpm dev:ios [--target SIMULATOR-UDID] [--url http://127.0.0.1:5173] [--existing] [--bundled]
自动启动开发服务，并在 iOS 模拟器中安装、打开 App。Ctrl+C 停止本次启动的服务。
默认使用已启动的模拟器，否则使用最近使用的 iPhone 模拟器。
--existing 复用另一个终端已经启动的 pnpm dev，退出时保留它。
--bundled 使用内置网页资源，适合验证断网和重启；修改页面后需重新运行命令。`

export function selectSimulator(data, target) {
  const devices = Object.entries(data.devices).filter(([runtime]) => runtime.includes('.iOS-')).flatMap(([runtime, devices]) => devices.filter((device) => device.isAvailable).map((device) => ({ ...device, runtime })))
  if (target) {
    const device = devices.find((device) => device.udid === target)
    if (!device) {
      throw new Error(`找不到可用的 iOS 模拟器：${target}。请运行 xcrun simctl list devices available 查看 UDID。`)
    }
    return device
  }
  devices.sort((a, b) => Number(b.state === 'Booted') - Number(a.state === 'Booted') ||
    Number(b.name.startsWith('iPhone')) - Number(a.name.startsWith('iPhone')) ||
    (b.lastUsedAt || '').localeCompare(a.lastUsedAt || '') ||
    b.runtime.localeCompare(a.runtime, undefined, { numeric: true }))
  if (!devices.length) {
    throw new Error('没有可用的 iOS 模拟器，请先在 Xcode 中安装 iOS Simulator 运行时。')
  }
  return devices[0]
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  if (args.includes('--help') || args.includes('-h')) {
    console.info(usage)
    return
  }
  if (process.platform !== 'darwin') {
    throw new Error('iOS 本地调试需要 macOS 和 Xcode。')
  }
  let target
  let url = 'http://127.0.0.1:5173'
  let existing = false
  let bundled = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--existing') {
      existing = true
    } else if (args[index] === '--bundled') {
      bundled = true
    } else if (['--target', '--url'].includes(args[index]) && args[index + 1] && !args[index + 1].startsWith('--')) {
      if (args[index] === '--target') {
        target = args[++index]
      } else {
        url = args[++index]
      }
    } else {
      throw new Error(`未知或缺少参数：${args[index]}\n${usage}`)
    }
  }
  const address = new URL(url)
  if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password || address.pathname !== '/' || address.search || address.hash) {
    throw new Error('--url 必须是开发服务器的 HTTP(S) 根地址。')
  }
  const { stdout } = await promisify(execFile)('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])
  const device = selectSimulator(JSON.parse(stdout), target)
  console.info(`iOS 调试：${device.name}，开发地址 ${address.origin}`)

  const controller = new AbortController()
  const children = new Set()
  const signalGroup = (child, signal) => {
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      if (error.code !== 'ESRCH') {
        console.error(error.message)
      }
    }
  }
  const stop = () => {
    controller.abort()
    for (const child of children) {
      signalGroup(child, 'SIGTERM')
    }
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  function start(command, args, env = process.env) {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', detached: true, env })
    if (child.pid) {
      children.add(child)
    }
    const done = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        // Also stop descendants when a wrapper exits unexpectedly.
        if (child.pid) {
          signalGroup(child, 'SIGTERM')
        }
        children.delete(child)
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`${command} ${args.join(' ')} 已退出（${signal || code}）。请查看上方错误。`))
        }
      })
    })
    void done.catch(() => {})
    return done
  }
  let services
  let serviceError
  try {
    if (!existing) {
      services = start('pnpm', ['dev'])
      void services.then(() => {
        serviceError = new Error('开发服务已退出。')
        stop()
      }, (error) => {
        serviceError = error
        stop()
      })
    }
    console.info(existing ? '等待已有开发服务就绪…' : '启动本地服务，等待 Vite 与 API 就绪…')
    await waitForApi({ url: `${address.origin}/api/v1/health`, timeout: 180_000, signal: controller.signal })
    controller.signal.throwIfAborted()
    await start(process.execPath, ['scripts/native.mjs', ...(bundled ? ['run', 'ios'] : ['dev', 'ios', '--run', '--url', address.origin]), '--target', device.udid], bundled ? { ...process.env, VITE_API_BASE_URL: `${address.origin}/api/v1` } : process.env)
    controller.signal.throwIfAborted()
    console.info(bundled ? 'App 已启动（内置资源）。关闭开发服务后仍可重启、使用本地工具；登录和 AI 仍需 API 服务。Ctrl+C 结束调试。' : 'App 已启动，修改 Vue / CSS 即可热更新。保持此终端运行，Ctrl+C 结束调试；再次打开时若服务不可用，将进入内置桌面。')
    while (!controller.signal.aborted) {
      await delay(60_000, undefined, { signal: controller.signal })
    }
  } catch (error) {
    if (serviceError) {
      throw serviceError
    }
    if (!controller.signal.aborted) {
      throw error
    }
  } finally {
    stop()
    // Bound cleanup even when a compiler or a grandchild ignores SIGTERM.
    if (children.size) {
      await delay(1500)
    }
    for (const child of children) {
      signalGroup(child, 'SIGKILL')
    }
    await services?.catch(() => {})
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
