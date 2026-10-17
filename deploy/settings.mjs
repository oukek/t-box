import { appendFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Public deployment conventions. Change them here when the installation needs a different layout.
const buckets = { web: 'tboxos', admin: 'tboxos-admin', apps: 'tboxos-app' }
const subdomains = { web: 'box', admin: 'admin', apps: 'apps', api: 'api' }
const applicationPrefix = 'builds'
const dockerPrefix = 'docker'

export function deploymentEnvironment(input = process.env) {
  const domain = input.DEPLOY_DOMAIN || ''
  const region = input.OSS_REGION || ''
  if (domain.length > 230 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error('Set DEPLOY_DOMAIN to your lowercase base domain, e.g. example.com, without protocol, path or port')
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(region) || region.startsWith('oss-') || region.endsWith('-internal')) {
    throw new Error('Set OSS_REGION to the actual bucket region, e.g. cn-hangzhou, without oss-')
  }
  const origin = (site) => `https://${subdomains[site]}.${domain}`
  const apiBase = `${origin('api')}/api/v1`
  return {
    OSS_REGION: region,
    OSS_ENDPOINT: `https://oss-${region}.aliyuncs.com`,
    WEB_OSS_BUCKET: buckets.web,
    ADMIN_OSS_BUCKET: buckets.admin,
    APPS_OSS_BUCKET: buckets.apps,
    WEB_ORIGIN: origin('web'),
    ADMIN_ORIGIN: origin('admin'),
    APP_ARTIFACT_ORIGIN: origin('apps'),
    API_BASE_URL: apiBase,
    APP_IMPORT_API_URL: `${apiBase}/application-builds`,
    APP_OSS_PREFIX: applicationPrefix,
    APP_ARTIFACT_DELIVERY: 'oss',
    // The optional Docker workflow uses the administration bucket's docker/ directory.
    OSS_BUCKET: buckets.admin,
    OSS_PREFIX: dockerPrefix,
  }
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error('Usage: node deploy/settings.mjs')
  }
  const environment = deploymentEnvironment()
  const lines = Object.entries(environment).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, lines)
  }
  process.stdout.write(lines)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(error.message + '\n')
    process.exitCode = 1
  })
}
