import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ossSettings, publishSite } from './oss-static.mjs'
import { prepareWebVerification } from './web-verification.mjs'

const target = process.argv[2] || 'all'
if (!['all', 'app', 'admin'].includes(target) || process.argv.length > 4 || (process.argv[3] && process.argv[3] !== '--check')) {
  throw new Error('Usage: node scripts/deploy-web-oss.mjs [all|app|admin]')
}
const api = new URL(process.env.API_BASE_URL || '')
if (api.protocol !== 'https:' || api.pathname !== '/api/v1' || api.username || api.password || api.hash || api.search) {
  throw new Error('Set API_BASE_URL to https://api.example.com/api/v1')
}
const targets = (target === 'all' ? ['app', 'admin'] : [target]).map((site) => ({
  site,
  settings: ossSettings(process.env[site === 'app' ? 'WEB_OSS_BUCKET' : 'ADMIN_OSS_BUCKET'], process.env[site === 'app' ? 'WEB_ORIGIN' : 'ADMIN_ORIGIN']),
}))
const configuredBuckets = ['WEB_OSS_BUCKET', 'ADMIN_OSS_BUCKET', 'APPS_OSS_BUCKET'].map((name) => process.env[name]).filter(Boolean)
const configuredOrigins = ['WEB_ORIGIN', 'ADMIN_ORIGIN', 'APP_ARTIFACT_ORIGIN'].map((name) => process.env[name]).filter(Boolean)
if (targets.some(({ settings }) => settings.origin === api.origin || settings.origin === process.env.APP_ARTIFACT_ORIGIN) ||
  configuredOrigins.includes(api.origin) || new Set(configuredBuckets).size !== configuredBuckets.length || new Set(configuredOrigins).size !== configuredOrigins.length) {
  throw new Error('Use separate buckets and origins for frontend, administration, applications and API')
}
if (process.argv[3] === '--check') {
  console.info('OSS website deployment settings validated.')
  process.exit(0)
}
const cwd = fileURLToPath(new URL('../', import.meta.url))
const run = (args) => {
  const environment = { ...process.env, VITE_API_BASE_URL: api.href }
  for (const name of ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_SESSION_TOKEN', 'APP_IMPORT_TOKEN']) {
    delete environment[name]
  }
  const result = spawnSync('pnpm', args, { cwd, stdio: 'inherit', env: environment })
  if (result.error || result.status !== 0) {
    throw new Error('Static website build failed')
  }
}
run(['build:contracts'])
for (const { site, settings } of targets) {
  run(['--filter', '@t-box/' + site, 'build'])
  const directory = fileURLToPath(new URL('../' + site + '/dist/', import.meta.url))
  if (site === 'app') {
    await prepareWebVerification(cwd, directory, settings.origin)
  }
  await publishSite(directory, settings)
  console.info(`${site} published and verified: ${settings.origin}`)
}
