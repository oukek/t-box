import { fork } from 'node:child_process'

// A fresh process also refreshes transitive ESM imports; a query on one module
// would still leave its dependencies cached in the long-lived dashboard.
export function readPreview(pinned, entry = new URL('./preview.mjs', import.meta.url)) {
  return new Promise((resolve, reject) => {
    const child = fork(entry, [], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
    let settled = false
    const timer = setTimeout(() => finish(new Error('读取发布计划超时，请重试')), 15000)
    function finish(error, value) {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      child.kill()
      if (error) {
        reject(error)
      } else {
        resolve(value)
      }
    }
    child.once('error', finish)
    child.once('exit', () => finish(new Error('发布计划读取进程提前退出')))
    child.once('message', (message) => finish(message.error ? new Error(message.error) : null, message.value))
    child.send({ pinned })
  })
}
