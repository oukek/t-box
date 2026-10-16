const { existsSync } = require('node:fs')
const { join, resolve } = require('node:path')

const release = resolve(__dirname, '..')
const shared = resolve(release, '../../shared')
if (!existsSync(join(release, 'api/.env')) || !existsSync(join(shared, 'logs'))) {
  throw new Error('Run control/prepare-release.mjs and configure shared/api.env before starting PM2')
}
const common = {
  interpreter: process.env.PM2_NODE || process.execPath,
  exec_mode: 'fork',
  instances: 1,
  watch: false,
  autorestart: true,
  exp_backoff_restart_delay: 1000,
  kill_timeout: 90000,
  time: true,
  env: { NODE_ENV: 'production' },
}
module.exports = {
  apps: [
    {
      ...common,
      name: 't-box-api',
      env: { ...common.env, TASK_WORKER_MODE: 'external' },
      cwd: join(release, 'api'),
      script: join(release, 'api/dist/server.js'),
      out_file: join(shared, 'logs/api-out.log'),
      error_file: join(shared, 'logs/api-error.log'),
    },
    {
      ...common,
      name: 't-box-worker',
      cwd: join(release, 'api'),
      script: join(release, 'api/dist/worker.js'),
      out_file: join(shared, 'logs/worker-out.log'),
      error_file: join(shared, 'logs/worker-error.log'),
    },
    {
      ...common,
      name: 't-box-artifacts',
      cwd: release,
      script: join(release, 'scripts/serve-application-artifacts.mjs'),
      args: [process.env.ARTIFACT_PORT || '6176', '127.0.0.1'],
      out_file: join(shared, 'logs/artifacts-out.log'),
      error_file: join(shared, 'logs/artifacts-error.log'),
    },
  ].filter(app => app.name !== 't-box-artifacts' || process.env.APP_ARTIFACT_DELIVERY !== 'oss'),
}
