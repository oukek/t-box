import type { AppRelease } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { createConnection } from 'mysql2/promise'
import { ApplicationArtifacts } from '../src/application-platform/artifacts.js'
import { ApplicationPublishing } from '../src/application-platform/publishing.js'
import { isDevelopmentRelease } from '../src/application-platform/release-source.js'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { initializeDatabase } from '../src/db/initialize.js'
import { ApplicationInstallationEntity, ApplicationReleaseEntity } from '../src/db/records/applications-entities.js'
import { databaseSchemas } from '../src/db/schema/index.js'

const { database: _database, ...options } = getConfig().mysql
const name = `t_box_test_publish_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const connection = await createConnection(options)
await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
const source = await createDataSource({ ...options, database: name }).initialize()
const root = await mkdtemp(join(tmpdir(), 'tbox-local-publish-'))
const originalDelivery = process.env.APP_ARTIFACT_DELIVERY
const originalNodeEnv = process.env.NODE_ENV
process.env.APP_ARTIFACT_DELIVERY = 'local'
const preview: AppRelease = {
  appId: 'fixture',
  releaseId: 'fixture-1.0.0',
  protocol: 1,
  kind: 'user',
  platforms: ['web'],
  defaultInstalled: false,
  manifest: { id: 'fixture', name: '测试应用', description: '本地发布回归', version: '1.0.0', icon: 'apps', color: 'blue', skillIds: [] },
  runtime: { type: 'web', entryUrl: 'http://localhost:5999/', integrity: 'sha256-' + '0'.repeat(64) },
  backend: { type: 'none', binding: '' },
  permissions: ['storage'],
  clientTools: [],
}
try {
  await initializeDatabase(source, databaseSchemas)
  await new ApplicationPlatform(source, [preview]).initialize()
  const userId = randomUUID()
  await source.getRepository(AppUserEntity).insert({ id: userId, username: 'local_publish', nickname: '测试', passwordHash: 'unused' })
  await source.getRepository(ApplicationInstallationEntity).insert({ user_id: userId, app_id: preview.appId, release_id: preview.releaseId, generation: 7, status: 'active', grants: ['storage'] })
  const deployed: AppRelease = { ...preview, releaseId: 'fixture-1.2.0', manifest: { ...preview.manifest, version: '1.2.0' }, permissions: ['storage', 'profile.read'] }
  const platform = new ApplicationPlatform(source, [deployed])
  const artifacts = new ApplicationArtifacts(root, { delivery: 'local' })
  const publishing = new ApplicationPublishing(source, platform, artifacts, 'http://localhost:6176')
  await platform.initialize()
  assert.ok(isDevelopmentRelease(deployed))
  assert.deepEqual(await publishing.readiness(deployed), { ready: false, development: true, reason: '开发预览，尚未绑定正式构建产物；请先构建并提交发布版本' })
  const file = Buffer.from('<html>immutable build</html>')
  const artifact = await artifacts.upload('fixture', { files: [{ path: 'index.html', content: file.toString('base64') }] })
  const results = await Promise.all([publishing.submitLocalBuild('fixture', '1.2.0', artifact.digest), publishing.submitLocalBuild('fixture', '1.2.0', artifact.digest)])
  assert.equal(results[0]!.releaseId, results[1]!.releaseId)
  const releaseId = results[0]!.releaseId
  let managed = (await publishing.list())[0]!
  let staged = managed.releases.find((row) => row.release.releaseId === releaseId)!
  assert.equal(staged.status, 'submitted')
  assert.deepEqual(staged.release.permissions, deployed.permissions, 'new build inherits deployed capabilities, not the older published preview')
  assert.equal(staged.release.runtime.type === 'web' && staged.release.runtime.entryUrl, `http://localhost:6176/fixture/${artifact.digest}/`)
  assert.equal(staged.readiness.ready, true)
  assert.equal(managed.currentReleaseId, preview.releaseId, 'submission must not publish')
  const installation = await source.getRepository(ApplicationInstallationEntity).findOneByOrFail({ user_id: userId, app_id: 'fixture' })
  assert.equal(installation.release_id, preview.releaseId)
  assert.equal(installation.generation, 7)
  assert.deepEqual(installation.grants, ['storage'])
  await publishing.updateMetadata(releaseId, { revision: staged.revision, releaseNotes: '人工填写说明', updatePrompt: { mode: 'custom', title: '新版本' } }, userId)
  const repeated = await publishing.submitLocalBuild('fixture', '1.2.0', artifact.digest)
  assert.equal(repeated.releaseId, releaseId)
  managed = (await publishing.list())[0]!
  staged = managed.releases.find((row) => row.release.releaseId === releaseId)!
  assert.equal(staged.releaseNotes, '人工填写说明')
  assert.equal(staged.release.updatePrompt?.title, '新版本')
  const changed = await artifacts.upload('fixture', { files: [{ path: 'index.html', content: Buffer.from('different').toString('base64') }] })
  await assert.rejects(publishing.submitLocalBuild('fixture', '1.2.0', changed.digest), /请提高应用版本号/)
  await assert.rejects(publishing.submitLocalBuild('fixture', '9.9.9', artifact.digest), /当前应用声明不一致/)
  await assert.rejects(publishing.transition(deployed.releaseId, { action: 'publish', revision: 1, expectedCurrentReleaseId: preview.releaseId }, userId), /开发预览/)
  await writeFile(join(root, 'fixture', artifact.digest, 'index.html'), 'corrupted')
  assert.equal((await publishing.readiness(staged.release)).ready, false)
  await assert.rejects(publishing.submitLocalBuild('fixture', '1.2.0', artifact.digest), /摘要不一致/)
  await writeFile(join(root, 'fixture', artifact.digest, 'index.html'), file)
  const wrongOrigin: AppRelease = { ...staged.release, runtime: { type: 'web', integrity: `sha256-${artifact.digest}`, entryUrl: `http://127.0.0.1:6176/fixture/${artifact.digest}/` } }
  assert.equal((await publishing.readiness(wrongOrigin)).ready, false, 'origin checks must not be relaxed')
  const remoteRequests: string[] = []
  const remote = new ApplicationArtifacts(root, {
    delivery: 'oss',
    origin: 'https://apps.example.com',
    fetcher: async (input) => {
      const path = new URL(String(input)).pathname
      remoteRequests.push(path)
      return new Response(new Uint8Array(await readFile(join(root, path))))
    },
  })
  const remotePublishing = new ApplicationPublishing(source, platform, remote, 'https://apps.example.com')
  assert.deepEqual((await remotePublishing.artifactList('fixture')).map((item) => item.digest), [artifact.digest])
  assert.ok(remoteRequests.every((path) => !path.includes('0'.repeat(64))), 'historical preview digests must never be fetched from OSS')
  await publishing.transition(releaseId, { action: 'publish', revision: staged.revision, expectedCurrentReleaseId: preview.releaseId }, userId)
  assert.equal((await publishing.submitLocalBuild('fixture', '1.2.0', artifact.digest)).status, 'published', 'rerun must not reset publication')
  assert.equal((await source.getRepository(ApplicationInstallationEntity).findOneByOrFail({ user_id: userId, app_id: 'fixture' })).release_id, preview.releaseId, 'publication must not rewrite pinned installs')
  await assert.rejects(platform.change(userId, 'fixture', 'update', releaseId, randomUUID(), ['storage']), /权限/)
  const updateKey = randomUUID()
  const updated = await platform.change(userId, 'fixture', 'update', releaseId, updateKey, staged.release.permissions)
  assert.equal(updated.status, 'completed')
  assert.deepEqual(await platform.change(userId, 'fixture', 'update', releaseId, updateKey, staged.release.permissions), updated, 'the same confirmed update cannot run twice')
  const installed = await source.getRepository(ApplicationInstallationEntity).findOneByOrFail({ user_id: userId, app_id: 'fixture' })
  assert.equal(installed.status, 'active')
  assert.equal(installed.release_id, releaseId)
  assert.equal(installed.target_release_id, null)
  assert.equal(installed.operation_id, null)
  assert.equal(installed.generation, 7)
  assert.deepEqual(installed.grants, staged.release.permissions)
  assert.equal((await source.getRepository(ApplicationReleaseEntity).findOneByOrFail({ release_id: deployed.releaseId })).definition.runtime.type === 'web', true, 'original preview remains intact')
  process.env.NODE_ENV = 'production'
  await assert.rejects(publishing.submitLocalBuild('fixture', '1.2.0', artifact.digest), /仅支持开发环境/)
  console.info('Local publishing passed: preview isolation, concurrent idempotency, trusted capabilities, manual publication, pinned grants, metadata preservation, digest/origin checks and immutable versions.')
} finally {
  if (originalDelivery === undefined) {
    delete process.env.APP_ARTIFACT_DELIVERY
  } else {
    process.env.APP_ARTIFACT_DELIVERY = originalDelivery
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
  await source.destroy()
  await connection.query(`DROP DATABASE \`${name}\``)
  await connection.end()
  await rm(root, { recursive: true, force: true })
}
