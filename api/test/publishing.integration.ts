/** Real DB and admin authentication; no live application versions are modified. */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createVault, hashPassword } from '../src/admin/crypto.js'
import { ConfigurationService } from '../src/admin/service.js'
import { AdminStore } from '../src/admin/store.js'
import { createApp } from '../src/app.js'
import { applicationArtifactRoot } from '../src/application-platform/artifacts.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const store = new AdminStore(source)
const platform = new PlatformService(source)
const app = createApp({
  platform,
  administration: new ConfigurationService(store, createVault(randomBytes(32))),
  bills: {} as any,
  health: async () => ({ mysql: 'up', redis: 'disabled' }),
})
const marker = randomUUID().replaceAll('-', '').slice(0, 12)
const appId = `test_publish_${marker}`
const systemId = `test_system_${marker}`
const users: string[] = []
let administratorId = ''
let cookie = ''
async function call(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  payload?: unknown,
  expected = 200,
  extra: Record<string, string> = {},
) {
  const response = await app.inject({
    method,
    url: '/api/v1/admin' + path,
    payload: payload === undefined ? undefined : JSON.stringify(payload),
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-admin-request': '1',
      ...extra,
    },
  })
  assert.equal(
    response.statusCode,
    expected,
    `${method} ${path}: ${response.body}`,
  )
  return response.json().data
}
const fixture = {
  appId,
  kind: 'user',
  version: '1.0.0',
  name: '发布测试',
  description: '独立测试应用',
  icon: 'apps',
  iconVariant: 'image',
  iconAsset: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12"/></svg>').toString('base64'),
  color: 'blue',
  runtime: 'web',
  artifact: '',
  releaseNotes: '首个版本',
  updatePrompt: { mode: 'custom', title: '计算体验升级', confirmText: '查看新版本' },
  revision: 1,
}
try {
  administratorId = await store.createUser(
    `publish_${marker}`,
    await hashPassword('test123'),
  )
  await call('GET', '/applications', undefined, 401)
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/session',
    payload: { username: `publish_${marker}`, password: 'test123' },
    headers: { 'x-admin-request': '1' },
  })
  assert.equal(login.statusCode, 200)
  cookie = String(login.headers['set-cookie']).split(';')[0] || ''
  const csrf = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/application-releases',
    headers: { cookie },
    payload: fixture,
  })
  assert.equal(csrf.statusCode, 403)
  const registration = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      username: `publish_user_${marker}`,
      password: 'test123',
      nickname: '发布测试',
    },
  })
  assert.equal(registration.statusCode, 201)
  const session = registration.json().data
  users.push(session.user.id)
  const market = async () => platform.applications.catalog(session.user.id)
  const initial = await market()
  assert.equal(
    initial.find((e) => e.release.appId === 'ledger')!.release.kind,
    'user',
  )
  assert.equal(
    initial.find((e) => e.release.appId === 'calculator')!.release.kind,
    'system',
  )
  const beforeRestore = await platform.applications.assertActive(
    session.user.id,
    'calculator',
  )
  // A legacy account may have uninstalled calculator before it became a system app.
  await source.query(
    'UPDATE application_installations SET status=\'revoked\',grants=JSON_ARRAY() WHERE user_id=? AND app_id=\'calculator\'',
    [session.user.id],
  )
  platform.applications.invalidateCatalog()
  const afterRestore = await platform.applications.assertActive(
    session.user.id,
    'calculator',
  )
  assert.equal(
    afterRestore.installation.generation,
    beforeRestore.installation.generation + 1,
  )
  const original = Buffer.from(
    '<!doctype html><html><title>Fixture</title><body>Application fixture</body></html>',
  )
  const uploaded = await call(
    'POST',
    `/applications/${appId}/artifacts`,
    { files: [{ path: 'index.html', content: original.toString('base64') }] },
    201,
  )
  fixture.artifact = uploaded.digest
  await call(
    'POST',
    `/applications/${appId}/artifacts`,
    { files: [{ path: '../escape', content: 'eA==' }] },
    400,
  )
  await call(
    'POST',
    '/application-releases',
    { ...fixture, backend: { binding: 'unknown' } },
    400,
  )
  await call('POST', '/application-releases', { ...fixture, iconAsset: 'data:image/svg+xml;base64,' + Buffer.from('<svg onload="alert(1)"></svg>').toString('base64') }, 400)
  await call('POST', '/application-releases', { ...fixture, updatePrompt: { mode: 'custom', script: 'untrusted' } }, 400)
  const first = await call('POST', '/application-releases', fixture, 201)
  await call('POST', '/application-releases', fixture, 409)
  assert.ok(
    !(await market()).some((e) => e.release.appId === appId),
    'draft is private',
  )
  await call(
    'POST',
    `/application-releases/${first.releaseId}/transitions`,
    { action: 'publish', revision: 1, expectedCurrentReleaseId: null },
    409,
  )
  const path = join(
    applicationArtifactRoot,
    appId,
    uploaded.digest,
    'index.html',
  )
  await writeFile(path, 'tampered')
  await call(
    'POST',
    `/application-releases/${first.releaseId}/transitions`,
    { action: 'submit', revision: 1, expectedCurrentReleaseId: null },
    400,
  )
  await writeFile(path, original)
  await call('POST', `/application-releases/${first.releaseId}/transitions`, {
    action: 'submit',
    revision: 1,
    expectedCurrentReleaseId: null,
  })
  await call(
    'PATCH',
    `/application-releases/${first.releaseId}`,
    { ...fixture, revision: 2, name: 'mutated' },
    409,
  )
  assert.ok(
    !(await market()).some((e) => e.release.appId === appId),
    'submission is private',
  )
  await call('POST', `/application-releases/${first.releaseId}/transitions`, {
    action: 'publish',
    revision: 2,
    expectedCurrentReleaseId: null,
  })
  const entry = (await market()).find((e) => e.release.appId === appId)!
  assert.equal(entry.installation, null)
  await platform.applications.change(
    session.user.id,
    appId,
    'install',
    first.releaseId,
    randomUUID(),
    [],
  )
  const old = await platform.applications.runtime(
    session.user.id,
    appId,
    'web',
  )
  const second = await call(
    'POST',
    '/application-releases',
    { ...fixture, version: '1.1.0', releaseNotes: '新增功能' },
    201,
  )
  await call('POST', `/application-releases/${second.releaseId}/transitions`, {
    action: 'submit',
    revision: 1,
    expectedCurrentReleaseId: first.releaseId,
  })
  await call(
    'POST',
    `/application-releases/${second.releaseId}/transitions`,
    {
      action: 'publish',
      revision: 2,
      expectedCurrentReleaseId: 'stale-release',
    },
    409,
  )
  await call('POST', `/application-releases/${second.releaseId}/transitions`, {
    action: 'publish',
    revision: 2,
    expectedCurrentReleaseId: first.releaseId,
  })
  assert.equal(
    (await platform.applications.runtime(session.user.id, appId, 'web'))
      .releaseId,
    first.releaseId,
    'publishing does not silently update installations',
  )
  await platform.applications.change(
    session.user.id,
    appId,
    'update',
    second.releaseId,
    randomUUID(),
    [],
  )
  assert.equal(
    (await platform.applications.runtime(session.user.id, appId, 'web'))
      .releaseId,
    second.releaseId,
  )
  await assert.rejects(
    platform.applications.assertActive(session.user.id, appId, old),
    /重新打开/,
  )
  await call(
    'POST',
    '/application-releases',
    { ...fixture, kind: 'system', version: '1.2.0' },
    400,
  )
  const list = await call('GET', '/applications')
  const current = list.applications.find((a: any) => a.appId === appId)
  assert.ok(
    Math.abs(Date.now() - new Date(current.releases[0].createdAt).getTime()) <
      60000,
    'publication metadata uses UTC consistently',
  )
  const retired = current.releases.find(
    (r: any) => r.release.releaseId === first.releaseId,
  )
  assert.equal(retired.status, 'retired')
  assert.deepEqual(retired.release.updatePrompt, fixture.updatePrompt)
  assert.equal(retired.release.manifest.iconAsset, fixture.iconAsset)
  assert.equal(retired.release.manifest.iconVariant, fixture.iconVariant)
  await call('POST', `/application-releases/${first.releaseId}/transitions`, {
    action: 'publish',
    revision: retired.revision,
    expectedCurrentReleaseId: second.releaseId,
  })
  assert.equal(
    (await platform.applications.runtime(session.user.id, appId, 'web'))
      .releaseId,
    second.releaseId,
    'rollback does not rewrite pinned installs',
  )
  const history = await call('GET', `/applications/${appId}/events`)
  assert.equal(history.filter((e: any) => e.action === 'publish').length, 3)
  assert.ok(history.every((e: any) => e.administratorId === administratorId))
  // A second API worker detects publication and bootstraps a newly introduced system app.
  const secondWorker = new PlatformService(source)
  await secondWorker.applications.catalog(session.user.id)
  const systemArtifact = await call(
    'POST',
    `/applications/${systemId}/artifacts`,
    { files: [{ path: 'index.html', content: original.toString('base64') }] },
    201,
  )
  const system = await call(
    'POST',
    '/application-releases',
    {
      ...fixture,
      appId: systemId,
      kind: 'system',
      artifact: systemArtifact.digest,
    },
    201,
  )
  await call('POST', `/application-releases/${system.releaseId}/transitions`, {
    action: 'submit',
    revision: 1,
    expectedCurrentReleaseId: null,
  })
  await call('POST', `/application-releases/${system.releaseId}/transitions`, {
    action: 'publish',
    revision: 2,
    expectedCurrentReleaseId: null,
  })
  const systemEntry = (
    await secondWorker.applications.catalog(session.user.id)
  ).find((e) => e.release.appId === systemId)!
  assert.equal(systemEntry.installation?.status, 'active')
  await assert.rejects(
    secondWorker.applications.change(
      session.user.id,
      systemId,
      'uninstall',
      system.releaseId,
      randomUUID(),
      [],
    ),
    /系统应用/,
  )
  // Uninstalling the user app immediately revokes runtime access; reinstallation uses a new generation.
  await platform.applications.change(
    session.user.id,
    appId,
    'uninstall',
    second.releaseId,
    randomUUID(),
    [],
  )
  await assert.rejects(
    platform.applications.runtime(session.user.id, appId, 'web'),
    /安装/,
  )
  await platform.applications.change(
    session.user.id,
    appId,
    'install',
    first.releaseId,
    randomUUID(),
    [],
  )
  assert.equal(
    (await platform.applications.runtime(session.user.id, appId, 'web'))
      .generation,
    2,
  )
  // All other live applications are unchanged by these fixture publications.
  assert.deepEqual(
    (await market())
      .filter((e) => ![appId, systemId].includes(e.release.appId))
      .map((e) => e.release.releaseId),
    initial.map((e) => e.release.releaseId),
  )
  console.info(
    'Application publishing passed: admin/CSRF isolation, artifact integrity, immutable versions, staged publication, pinned updates, rollback audit, cross-worker system installation and uninstall policy.',
  )
} finally {
  await app.close()
  await cleanupUsers(source, users)
  // A concurrently browsing real user can only receive the disposable test system app. Remove only that app's own fixture rows.
  for (const id of [appId, systemId]) {
    await source.query(
      'DELETE FROM application_lifecycle_operations WHERE app_id=?',
      [id],
    )
    await source.query('DELETE FROM application_installations WHERE app_id=?', [
      id,
    ])
    await source.query(
      'DELETE FROM application_publication_events WHERE app_id=?',
      [id],
    )
    await source.query('DELETE FROM application_releases WHERE app_id=?', [id])
    await source.query('DELETE FROM application_registry WHERE app_id=?', [id])
    await rm(join(applicationArtifactRoot, id), {
      recursive: true,
      force: true,
    })
  }
  if (administratorId) {
    await source.query('DELETE FROM admin_sessions WHERE admin_id=?', [
      administratorId,
    ])
    await source.query('DELETE FROM admin_users WHERE id=?', [administratorId])
  }
  await source.destroy()
}
