import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ApplicationArtifacts } from '../src/application-platform/artifacts.js'
import { runtimeResourceStorage } from '../src/resources/runtime-storage.js'

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
function fixture() {
  const values = { 'index.html': '<html>OSS only</html>', 'assets/main.js': 'console.log(1)' }
  const files = Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => [path, sha(content)]))
  const digest = sha(JSON.stringify(files))
  const base = `https://apps.example.com/notes/${digest}/`
  const objects = new Map(Object.entries(values).map(([path, content]) => [base + path, content]))
  objects.set(base + 'artifact.json', JSON.stringify({ protocol: 1, appId: 'notes', digest, files }))
  const requested: string[] = []
  const fetcher: typeof fetch = async (input, options) => {
    const url = String(input)
    requested.push(url)
    assert.equal(options?.redirect, 'error')
    assert.equal(options?.cache, 'no-store')
    assert.equal(options?.headers, undefined)
    const content = objects.get(url)
    return new Response(content, { status: content === undefined ? 404 : 200 })
  }
  return { objects, digest, base, requested, fetcher, input: { files: Object.entries(values).map(([path, content]) => ({ path, content: Buffer.from(content).toString('base64') })) } }
}

test('OSS build import, verification and listing never create an application file on the server', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tbox-oss-only-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const f = fixture()
  const artifacts = new ApplicationArtifacts(join(root, 'must-not-exist'), { delivery: 'oss', origin: 'https://apps.example.com', fetcher: f.fetcher })
  const uploaded = await artifacts.upload('notes', f.input)
  assert.equal(uploaded.digest, f.digest)
  assert.equal(uploaded.fileCount, 2)
  assert.equal((await artifacts.verify('notes', f.digest)).bytes, uploaded.bytes)
  assert.equal((await artifacts.list('notes', [f.digest, f.digest])).length, 1)
  assert.deepEqual(await readdir(root), [])
  assert.ok(f.requested.every((url) => url.startsWith(f.base)))
})

test('OSS verification refuses missing, altered and unsafe artifacts without local fallback', async () => {
  for (const corrupt of ['missing', 'changed', 'manifest', 'path']) {
    const f = fixture()
    if (corrupt === 'missing') {
      f.objects.delete(f.base + 'assets/main.js')
    }
    if (corrupt === 'changed') {
      f.objects.set(f.base + 'assets/main.js', 'altered')
    }
    if (corrupt === 'manifest') {
      f.objects.set(f.base + 'artifact.json', '{}')
    }
    if (corrupt === 'path') {
      f.objects.set(f.base + 'artifact.json', JSON.stringify({ protocol: 1, appId: 'notes', digest: f.digest, files: { '../escape': sha('x') } }))
    }
    const artifacts = new ApplicationArtifacts('/must-not-be-used', { delivery: 'oss', origin: 'https://apps.example.com', fetcher: f.fetcher })
    await assert.rejects(artifacts.verify('notes', f.digest))
    assert.ok(f.requested.every((url) => url.startsWith(f.base)))
  }
})

test('production file storage excludes local objects and refuses local application persistence', () => {
  const names = ['NODE_ENV', 'OSS_REGION', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'APP_ARTIFACT_DELIVERY'] as const
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    Object.assign(process.env, { NODE_ENV: 'production', OSS_REGION: 'cn-hangzhou', OSS_ACCESS_KEY_ID: 'fixture', OSS_ACCESS_KEY_SECRET: 'fixture-secret', APP_ARTIFACT_DELIVERY: 'oss' })
    const storage = runtimeResourceStorage('/must-not-be-used')
    assert.match(storage.activeId, /^oss-/)
    assert.throws(() => storage.get('local'), { code: 'RESOURCE_STORAGE_UNAVAILABLE' })
    assert.throws(() => new ApplicationArtifacts('/must-not-be-used', { delivery: 'local' }), /must be stored in OSS/)
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = previous[name]
      }
    }
  }
})
