import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256, validAppId, validVersion } from './application-builds.mjs'
import { ossSettings, publishArtifact } from './oss-static.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const appId = process.argv[2]
const version = process.argv[3]
if (!validAppId(appId) || !validVersion(version)) {
  throw new Error('Provide app ID and version')
}
const directory = resolve(process.env.APP_RELEASE_OUTPUT || join(root, 'output/application-releases'), appId, version)
const release = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'))
if (release.appId !== appId || release.version !== version || !/^[a-f0-9]{64}$/.test(release.sha256) || release.file !== release.sha256 + '.json') {
  throw new Error('Release metadata is invalid')
}
const bytes = await readFile(join(directory, release.file))
if (sha256(bytes) !== release.sha256) {
  throw new Error('Release bundle checksum mismatch')
}
const settings = ossSettings(process.env.APPS_OSS_BUCKET, process.env.APP_ARTIFACT_ORIGIN)
const prefix = process.env.APP_OSS_PREFIX || 'builds'
const region = process.env.OSS_REGION || ''
if (!/^[\w-]+(?:\/[\w-]+)*$/.test(prefix)) {
  throw new Error('APP_OSS_PREFIX must contain only safe path segments; defaults to builds')
}
const token = process.env.APP_IMPORT_TOKEN || ''
const api = new URL(process.env.APP_IMPORT_API_URL || (process.env.API_BASE_URL ? process.env.API_BASE_URL + '/application-builds' : ''))
if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || api.pathname !== '/api/v1/application-builds' || !/^tbox_build_[\w-]{43}$/.test(token)) {
  throw new Error('Configure HTTPS APP_IMPORT_API_URL ending in /api/v1/application-builds and scoped APP_IMPORT_TOKEN')
}
const source = { repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID }
if (!/^[\w.-]+\/[\w.-]+$/.test(source.repository || '') || !/^[a-f0-9]{40}$/.test(source.commit || '') || !/^\d{1,30}$/.test(source.runId || '')) {
  throw new Error('GitHub build provenance is required')
}
const path = `${prefix}/${appId}/${version}/${release.file}`
const object = `oss://${settings.bucket}/${path}`
const bundle = JSON.parse(bytes.toString('utf8'))
if (bundle.protocol !== 1 || bundle.appId !== appId || bundle.version !== version || !Array.isArray(bundle.files) || bundle.artifact !== release.artifact) {
  throw new Error('Release static files do not match the registered build')
}
// Never register a version until the exact static files are publicly available on OSS.
await publishArtifact(appId, bundle.artifact, bundle.files, settings)
const run = (args) => {
  const result = spawnSync('ossutil', args, { env: settings.environment, encoding: 'utf8', timeout: 180_000, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0) {
    // CLI output can contain credentials; do not print it.
    throw new Error('OSS operation failed; check AccessKey permissions and bucket configuration')
  }
}
run(['cp', join(directory, release.file), object, '--force', '--acl', 'public-read', '--content-type', 'application/json', '--cache-control', 'public,max-age=31536000,immutable'])
const url = new URL(`https://${settings.bucket}.oss-${region}.aliyuncs.com/${path}`)
const request = JSON.stringify({ appId, version, url: url.href, sha256: release.sha256, source })
let data
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    const response = await fetch(api, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(90_000),
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      body: request,
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(`Server rejected build (${response.status}): ${String(result.error?.code || 'UNKNOWN')}`)
      error.retryable = response.status >= 500 || response.status === 429
      throw error
    }
    if (!result.data?.releaseId || !['submitted', 'published', 'retired'].includes(result.data.status)) {
      const error = new Error('Unexpected import response')
      error.retryable = false
      throw error
    }
    data = result.data
    break
  } catch (error) {
    if (error.retryable === false || attempt === 5) {
      // Network exceptions may embed URLs/headers; use a sanitized diagnostic.
      throw new Error(error.retryable !== undefined ? error.message : 'Build submission failed after retries; check API connectivity and server logs')
    }
    await new Promise((done) => setTimeout(done, 1000 * 2 ** (attempt - 1)))
  }
}
console.info(`Build registered: ${appId} ${version}, release ${data.releaseId}, status ${data.status}. Publication requires an administrator.`)
