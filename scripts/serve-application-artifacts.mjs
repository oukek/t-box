import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(
  fileURLToPath(new URL('../output/app-artifacts', import.meta.url)),
)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
}
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405)
      res.end()
      return
    }
    const pathname = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname,
    )
    const match = /^\/([a-z][a-z0-9_-]{0,63})\/([a-f0-9]{64})\/(.*)$/.exec(
      pathname,
    )
    if (!match) {
      throw new Error('Not found')
    }
    const [, appId, digest] = match
    const file = match[3] || 'index.html'
    if (
      file.split('/').some((part) => ['..', '.', ''].includes(part)) ||
      file.includes('\\')
    ) {
      throw new Error('Invalid path')
    }
    const artifactRoot = join(root, appId, digest)
    const manifest = JSON.parse(
      await readFile(join(artifactRoot, 'artifact.json'), 'utf8'),
    )
    if (
      createHash('sha256')
        .update(JSON.stringify(manifest.files))
        .digest('hex') !== digest ||
        !Object.hasOwn(manifest.files, file)
    ) {
      throw new Error('Invalid artifact')
    }
    const bytes = await readFile(join(artifactRoot, file))
    if (
      createHash('sha256').update(bytes).digest('hex') !== manifest.files[file]
    ) {
      throw new Error('Artifact changed')
    }
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'public,max-age=31536000,immutable',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy':
        'default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'; font-src \'self\'; base-uri \'none\'; form-action \'none\'; frame-src \'none\'; object-src \'none\'',
    })
    res.end(req.method === 'HEAD' ? undefined : bytes)
  } catch {
    res.writeHead(404)
    res.end('Application artifact unavailable')
  }
})
server.listen(
  Number(process.argv[2] || 6176),
  process.argv[3] || '127.0.0.1',
  () =>
    console.info(
      'Application artifact server listening; publish through a separate HTTPS origin in production.',
    ),
)
