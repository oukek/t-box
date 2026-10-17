import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { collectBuildFiles, sha256, validAppId } from './application-builds.mjs'

export function ossSettings(bucket, origin, env = process.env) {
  const region = env.OSS_REGION || ''
  const endpoint = env.OSS_ENDPOINT || `https://oss-${region}.aliyuncs.com`
  const url = new URL(origin || '')
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket || '') ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(region) || endpoint !== `https://oss-${region}.aliyuncs.com` ||
    url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
    throw new Error('Configure an OSS bucket, OSS_REGION, public OSS_ENDPOINT and an exact custom HTTPS origin without a trailing slash')
  }
  if (!env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET) {
    throw new Error('Configure OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET')
  }
  const environment = { ...env, OSS_ENDPOINT: endpoint }
  delete environment.APP_IMPORT_TOKEN
  delete environment.PM2_SSH_PASSWORD
  delete environment.PM2_SSH_PRIVATE_KEY
  return { bucket, origin, environment }
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}
export function contentType(path) {
  return path.endsWith('/apple-app-site-association') ? 'application/json' : types[extname(path)] || 'application/octet-stream'
}

export async function publishFiles(files, settings, {
  prefix = '',
  immutable = false,
  marker,
  run = (args, env) => {
    const result = spawnSync('ossutil', args, { env, encoding: 'utf8', timeout: 180_000, maxBuffer: 1024 * 1024 })
    if (result.error || result.status !== 0) {
      throw new Error('OSS upload failed; check bucket, credentials and PutObject permissions')
    }
  },
  request = globalThis.fetch,
} = {}) {
  if (prefix && !/^[\w-]+(?:\/[\w-]+)*\/$/.test(prefix)) {
    throw new Error('Invalid static object prefix')
  }
  const entries = new Map()
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || file.path.length > 240 ||
      !/^[\w./@-]+$/.test(file.path) || file.path.split('/').some((part) => !part || part === '.' || part === '..' || /^\.env(?:\.|$)/.test(part) || part === '.git' || part === '.secrets') ||
      /\.(?:pem|key|p12|pfx|map)$/i.test(file.path) || entries.has(file.path) || typeof file.content !== 'string') {
      throw new Error('Static upload contains an unsafe, secret, duplicate or source-map path')
    }
    const bytes = Buffer.from(file.content, 'base64')
    if (bytes.toString('base64') !== file.content || bytes.length > 5 * 1024 * 1024) {
      throw new Error('Invalid static file encoding or size')
    }
    entries.set(file.path, bytes)
  }
  if (!entries.has('index.html') || entries.size > 2001 || [...entries.values()].reduce((total, bytes) => total + bytes.length, 0) > 21 * 1024 * 1024) {
    throw new Error('Static build is missing index.html or exceeds artifact limits')
  }
  // Publish dependency files before the HTML entry; activate a worker/manifest only after all files verify.
  const priority = (path) => path === marker ? 3 : path === 'tbox-offline-sw.js' ? 2 : path === 'index.html' ? 1 : 0
  const ordered = [...entries].sort(([a], [b]) => priority(a) - priority(b) || a.localeCompare(b))
  const temporary = await mkdtemp(join(tmpdir(), 'tbox-oss-static-'))
  try {
    for (const [path, bytes] of ordered) {
      const source = join(temporary, 'object')
      await writeFile(source, bytes)
      const name = path.split('/').at(-1).split('.').slice(0, -1).join('.')
      const suffix = name.slice(name.lastIndexOf('-') + 1)
      const hashed = path.startsWith('assets/') && name.includes('-') && suffix.length >= 8 && /^[\w-]+$/.test(suffix)
      const cache = immutable || hashed ? 'public,max-age=31536000,immutable' : 'no-cache'
      await run(['cp', source, `oss://${settings.bucket}/${prefix}${path}`, '--force', '--acl', 'public-read', '--content-type', contentType(path), '--cache-control', cache], settings.environment)
      const url = new URL(`${settings.origin}/${prefix}${path}`)
      url.searchParams.set('tbox_sha256', sha256(bytes))
      const response = await request(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) })
      if (!response.ok || !response.body) {
        throw new Error('Published static file is not publicly reachable; check OSS website, domain and HTTPS settings')
      }
      const reader = response.body.getReader()
      const chunks = []
      let length = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          length += value.length
          if (length > bytes.length) {
            throw new Error('Published static file exceeds its expected size')
          }
          chunks.push(Buffer.from(value))
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
      if (sha256(Buffer.concat(chunks)) !== sha256(bytes)) {
        throw new Error('Published static file checksum mismatch; check CDN caches or content rewriting')
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  return entries.size
}

export async function publishArtifact(appId, artifact, files, settings, options) {
  const sorted = Object.fromEntries(files.map((file) => [file.path, sha256(Buffer.from(file.content, 'base64'))]).sort(([a], [b]) => a.localeCompare(b)))
  if (!validAppId(appId) || !/^[a-f0-9]{64}$/.test(artifact) || sha256(JSON.stringify(sorted)) !== artifact) {
    throw new Error('Static artifact digest mismatch')
  }
  const manifest = Buffer.from(JSON.stringify({ protocol: 1, appId, digest: artifact, files: sorted }, null, 2) + '\n')
  return publishFiles([...files, { path: 'artifact.json', content: manifest.toString('base64') }], settings, { ...options, prefix: `${appId}/${artifact}/`, immutable: true, marker: 'artifact.json' })
}

export async function publishBootstrap(root, settings, options) {
  const { readdir } = await import('node:fs/promises')
  for (const application of await readdir(root, { withFileTypes: true })) {
    if (!application.isDirectory() || !validAppId(application.name)) {
      throw new Error('Invalid bootstrap application')
    }
    for (const entry of await readdir(join(root, application.name), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) {
        throw new Error('Invalid bootstrap artifact')
      }
      const directory = join(root, application.name, entry.name)
      const manifest = JSON.parse(await readFile(join(directory, 'artifact.json'), 'utf8'))
      const files = []
      for (const [path, digest] of Object.entries(manifest.files)) {
        if (!/^[\w./@-]+$/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) {
          throw new Error('Invalid bootstrap file path')
        }
        const bytes = await readFile(join(directory, path))
        if (sha256(bytes) !== digest) {
          throw new Error('Bootstrap file checksum mismatch')
        }
        files.push({ path, content: bytes.toString('base64') })
      }
      await publishArtifact(application.name, entry.name, files, settings, options)
    }
  }
}

export async function publishSite(directory, settings, options) {
  const { files } = await collectBuildFiles(directory)
  return publishFiles(files, settings, options)
}
