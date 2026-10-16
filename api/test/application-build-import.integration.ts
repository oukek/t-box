import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError } from '@t-box/server-foundation/errors'
import Fastify from 'fastify'
import { hashPassword } from '../src/admin/crypto.js'
import { AdminStore } from '../src/admin/store.js'
import { ApplicationArtifacts } from '../src/application-platform/artifacts.js'
import { ApplicationBuildImports, bundleHash } from '../src/application-platform/build-import.js'
import { createImportCredential } from '../src/application-platform/import-credential.js'
import { registerApplicationBuildImports } from '../src/application-platform/import-routes.js'
import { ApplicationPublishing } from '../src/application-platform/publishing.js'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { createDataSource } from '../src/db/data-source.js'

const source = await createDataSource().initialize()
const marker = randomUUID().slice(0, 8)
const appId = 'test_ci_' + marker
const username = 'test_ci_' + marker
const root = await mkdtemp(join(tmpdir(), 'tbox-ci-artifacts-'))
const platform = new ApplicationPlatform(source, [])
const publishing = new ApplicationPublishing(source, platform, new ApplicationArtifacts(root), 'https://apps.example.com')
const objects = new Map<string, Buffer>()
let downloads = 0
const fetcher = (async (input, options) => {
  downloads++
  assert.equal(options?.redirect, 'error')
  const value = objects.get(new URL(String(input)).pathname)
  return value ? new Response(new Uint8Array(value)) : new Response('missing', { status: 404 })
}) as typeof fetch
const origin = 'https://tboxos-app.oss-cn-hangzhou.aliyuncs.com'
const imports = new ApplicationBuildImports(source, publishing, origin, 'builds', fetcher)
const app = Fastify()
app.setErrorHandler((error, _r, reply) => {
  if (error instanceof ApiError) {
    return reply.code(error.statusCode).send({ error: { code: error.code } })
  }
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR' } })
})
registerApplicationBuildImports(app, imports)
let admin = ''
const credentialIds: string[] = []
const files = [{ path: 'index.html', content: Buffer.from('<html>CI fixture</html>').toString('base64') }]
const artifact = bundleHash(JSON.stringify({ 'index.html': bundleHash(Buffer.from(files[0]!.content, 'base64')) }))
function build(notes = 'CI test') {
  const bytes = Buffer.from(JSON.stringify({
    protocol: 1,
    appId,
    version: '1.0.1',
    artifact,
    files,
    releaseNotes: notes,
    publication: { updatePrompt: { mode: 'custom', title: '新版本可用' }, kind: 'user', name: 'CI fixture', description: 'Independent static fixture', icon: 'apps', iconAsset: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>').toString('base64'), color: 'blue' },
  }))
  const sha256 = bundleHash(bytes)
  const path = '/builds/' + appId + '/1.0.1/' + sha256 + '.json'
  objects.set(path, bytes)
  return {
    appId,
    version: '1.0.1',
    sha256,
    url: origin + path,
    source: { repository: 'test/repo', commit: 'a'.repeat(40), runId: '123' },
  }
}
const payload = build()
const call = (token: string, body: unknown = payload) => app.inject({
  method: 'POST',
  url: '/api/v1/application-builds',
  headers: { 'authorization': 'Bearer ' + token, 'content-type': 'application/json' },
  payload: JSON.stringify(body),
})
try {
  admin = await new AdminStore(source).createUser(username, await hashPassword('test123'))
  const credential = await createImportCredential(source, username, [appId], 1)
  credentialIds.push(credential.id)
  const wrongScope = await createImportCredential(source, username, ['calculator'], 1)
  credentialIds.push(wrongScope.id)
  assert.equal((await call('invalid')).statusCode, 401)
  assert.equal((await call(wrongScope.token)).statusCode, 403)
  assert.equal(downloads, 0, 'unauthorized requests must not download anything')
  assert.equal((await call(credential.token, { ...payload, url: 'https://127.0.0.1/secret' })).statusCode, 400)
  assert.equal(downloads, 0)
  const results = await Promise.all([call(credential.token), call(credential.token)])
  for (const response of results) {
    assert.equal(response.statusCode, 201, response.body)
    assert.equal(response.json().data.status, 'submitted')
  }
  const releaseId = results[0]!.json().data.releaseId
  assert.equal(results[1]!.json().data.releaseId, releaseId, 'concurrent retry must reuse the release')
  const [stored] = await source.query('SELECT published,status,revision,definition FROM application_releases WHERE release_id=?', [releaseId])
  assert.equal(stored.published, 0)
  assert.equal(stored.status, 'submitted')
  assert.equal(stored.revision, 1)
  assert.ok(!(await publishing.list()).find((a) => a.appId === appId)?.currentReleaseId)
  const [provenance] = await source.query('SELECT object_url,source FROM application_build_imports WHERE app_id=?', [appId])
  assert.equal(provenance.object_url, payload.url)
  // Previously signed imports still resolve to the same immutable build without persisting query credentials.
  const legacy = await call(credential.token, { ...payload, url: payload.url + '?signature=never-persist' })
  assert.equal(legacy.statusCode, 201, legacy.body)
  assert.equal(legacy.json().data.releaseId, releaseId)
  const [afterLegacy] = await source.query('SELECT object_url FROM application_build_imports WHERE app_id=?', [appId])
  assert.equal(afterLegacy.object_url, payload.url)
  assert.equal((await call(credential.token, build('different notes'))).statusCode, 409)
  const old = JSON.parse(typeof stored.definition === 'string' ? stored.definition : JSON.stringify(stored.definition))
  assert.deepEqual(old.updatePrompt, { mode: 'custom', title: '新版本可用' })
  await assert.rejects(publishing.save({
    appId,
    version: '1.0.2',
    kind: 'user',
    runtime: 'web',
    artifact,
    name: 'CI fixture',
    description: 'Test',
    icon: 'apps',
    color: 'blue',
    releaseNotes: '',
    backend: { type: 'local', binding: 'ledger' },
  }, admin), /不支持/)
  assert.equal(old.backend.type, 'none')
  assert.deepEqual(old.permissions, [])
  // Only a separately authenticated administrator can publish; importer has no transition endpoint.
  const denied = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/application-releases/' + releaseId + '/transitions',
    headers: { authorization: 'Bearer ' + credential.token },
    payload: { action: 'publish', revision: 1, expectedCurrentReleaseId: null },
  })
  assert.equal(denied.statusCode, 404)
  await publishing.transition(releaseId, { action: 'publish', revision: 1, expectedCurrentReleaseId: null }, admin)
  const repeated = await call(credential.token)
  assert.equal(repeated.statusCode, 201)
  assert.equal(repeated.json().data.status, 'published')
  assert.equal(repeated.json().data.releaseId, releaseId)
  const [counts] = await source.query('SELECT COUNT(*) AS total FROM application_releases WHERE app_id=?', [appId])
  assert.equal(Number(counts.total), 1)
  await source.query('UPDATE application_import_credentials SET expires_at=UTC_TIMESTAMP(3) WHERE id=?', [wrongScope.id])
  assert.equal((await call(wrongScope.token)).statusCode, 401)
  await source.query('UPDATE admin_users SET enabled=0 WHERE id=?', [admin])
  assert.equal((await call(credential.token)).statusCode, 401)
  await source.query('UPDATE admin_users SET enabled=1 WHERE id=?', [admin])
  await source.query('UPDATE application_import_credentials SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?', [credential.id])
  assert.equal((await call(credential.token)).statusCode, 401)
  console.info('Application CI import passed: real DB/HTTP authentication, app scopes, OSS origin restrictions, concurrent idempotency, immutable versions, provenance, manual publication, expiry and revocation.')
} finally {
  await app.close()
  await source.query('DELETE FROM application_build_imports WHERE app_id=?', [appId])
  await source.query('DELETE FROM application_publication_events WHERE app_id=?', [appId])
  await source.query('DELETE FROM application_releases WHERE app_id=?', [appId])
  await source.query('DELETE FROM application_registry WHERE app_id=?', [appId])
  for (const id of credentialIds) {
    await source.query('DELETE FROM application_import_credentials WHERE id=?', [id])
  }
  if (admin) {
    await source.query('DELETE FROM admin_users WHERE id=?', [admin])
  }
  await source.destroy()
  await rm(root, { recursive: true, force: true })
}
