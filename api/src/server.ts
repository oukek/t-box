import { createRuntime } from './bootstrap/runtime.js'

const { app, config } = await createRuntime(process.env.TASK_WORKER_MODE !== 'external' && process.env.TASK_WORKER_MODE !== 'disabled')

let closing = false
async function shutdown() {
  if (closing) {
    return
  }
  closing = true
  try {
    await app.close()
  } catch {
    process.exitCode = 1
  }
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(
    { code: (error as NodeJS.ErrnoException).code ?? 'START_FAILED' },
    'API startup failed',
  )
  await shutdown()
  process.exitCode = 1
}
