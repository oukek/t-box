import { createRuntime } from './bootstrap/runtime.js'

// Dedicated recovery process: no HTTP listener, no synthetic client, same execution engine.
const { app } = await createRuntime(true)
let closing = false
async function shutdown() {
  if (closing) {
    return
  }
  closing = true
  await app.close().catch(() => process.exitCode = 1)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
try {
  await app.ready()
  app.log.info('Task recovery worker ready')
} catch {
  app.log.error({ code: 'WORKER_START_FAILED' }, 'Task recovery worker startup failed')
  await shutdown()
  process.exitCode = 1
}
