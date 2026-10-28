import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { createOssClient, ossClientOptions, putOssObject } from '../deploy/oss/client.mjs'
import { collectBuildFiles, sha256, validAppId } from './application-builds.mjs'

export function ossSettings(bucket, origin, env = process.env) {
  const clientOptions = ossClientOptions(bucket, env)
  const url = new URL(origin || '')
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
    throw new Error('Configure an exact custom HTTPS origin without a trailing slash')
  }
  return { bucket, origin, clientOptions }
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

class PublicFileError extends Error {
  constructor(message, retryable = false) {
    super(message)
    this.retryable = retryable
  }
}

const transientCodes = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'TimeoutError', 'AbortError'])
const publicReadCodes = new Set([...transientCodes, 'ENOTFOUND', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT'])

async function verifyPublicFileOnce(url, bytes, request) {
  const response = await request(url, { redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30_000) })
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw new PublicFileError(`Published static entry/file is not publicly reachable (HTTP ${response.status}); check OSS website index, subdirectory index, domain and HTTPS settings`, [408, 429, 500, 502, 503, 504].includes(response.status))
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
        throw new PublicFileError('Published static file exceeds its expected size')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  if (sha256(Buffer.concat(chunks)) !== sha256(bytes)) {
    throw new PublicFileError('Published static file checksum mismatch; check CDN caches or content rewriting')
  }
}

async function verifyPublicFile(url, bytes, request, pause) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await verifyPublicFileOnce(url, bytes, request)
      return
    } catch (error) {
      const code = [error?.cause?.code, error?.code, error?.cause?.name, error?.name].find((value) => publicReadCodes.has(value)) || 'NetworkError'
      const local = error instanceof PublicFileError
      const detail = local ? error.message : `HTTPS read failed (code=${code}); check runner connectivity, custom domain DNS, CDN routing/access controls and HTTPS`
      if (!(local ? error.retryable : transientCodes.has(code)) || attempt === 3) {
        const failure = new Error(`Public static verification failed after ${attempt} attempt(s): ${url.href}. ${detail}`)
        if (!local && transientCodes.has(code)) {
          failure.code = code
        }
        throw failure
      }
      console.warn(`Public static verification retry ${attempt}/3: ${url.href}. ${detail}`)
      await pause(attempt * 1000)
    }
  }
}

export async function publishFiles(files, settings, {
  prefix = '',
  immutable = false,
  marker,
  client,
  request = globalThis.fetch,
  pause = setTimeout,
  verification = { ossOnly: false },
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
  const storage = client || createOssClient(settings.clientOptions)
  const verify = async (url, key, bytes) => {
    let fallbackReason
    if (!verification.ossOnly) {
      try {
        await verifyPublicFile(url, bytes, request, pause)
        return
      } catch (error) {
        if (!transientCodes.has(error.code)) {
          throw error
        }
        fallbackReason = error.message
      }
    }
    const endpoint = new URL(settings.clientOptions.endpoint)
    const direct = new URL(`https://${settings.bucket}.${endpoint.hostname}/${key}`)
    direct.searchParams.set('tbox_sha256', sha256(bytes))
    // Anonymous reads still require public ACLs and exact uploaded bytes. A CDN
    // routing failure must not be confused with a missing/private/corrupt object.
    await verifyPublicFile(direct, bytes, request, pause)
    if (fallbackReason) {
      verification.ossOnly = true
      console.warn(`${fallbackReason}\n::warning::Uploaded object verified through public OSS instead. CDN/custom-domain reachability and directory indexes remain unverified; remaining files will use public OSS reads. Confirm ${settings.origin} from the target network.`)
    }
  }
  for (const [path, bytes] of ordered) {
    const name = path.split('/').at(-1).split('.').slice(0, -1).join('.')
    const suffix = name.slice(name.lastIndexOf('-') + 1)
    const hashed = path.startsWith('assets/') && name.includes('-') && suffix.length >= 8 && /^[\w-]+$/.test(suffix)
    const cache = immutable || hashed ? 'public,max-age=31536000,immutable' : 'no-cache'
    await putOssObject(storage, prefix + path, bytes, { mime: contentType(path), headers: { 'x-oss-object-acl': 'public-read', 'Cache-Control': cache } })
    const url = new URL(`${settings.origin}/${prefix}${path}`)
    url.searchParams.set('tbox_sha256', sha256(bytes))
    await verify(url, prefix + path, bytes)
    if (path === 'index.html' && !verification.ossOnly) {
      // Verify the exact URL users open, without a query that bypasses a broken CDN cache.
      await verify(new URL(`${settings.origin}/${prefix}`), prefix + path, bytes)
    }
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

export async function publishBootstrap(root, settings, options = {}) {
  const { readdir } = await import('node:fs/promises')
  const shared = { ...options, verification: options.verification || { ossOnly: false } }
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
      await publishArtifact(application.name, entry.name, files, settings, shared)
    }
  }
}

export async function publishSite(directory, settings, options) {
  const { files } = await collectBuildFiles(directory)
  return publishFiles(files, settings, options)
}
