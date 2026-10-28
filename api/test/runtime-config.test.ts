import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
function fixture(t: { after: (cleanup: () => void) => void }, metadata?: object) {
  const root = mkdtempSync(join(tmpdir(), 'tbox-runtime-config-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'api/src'), { recursive: true })
  mkdirSync(join(root, 'api/node_modules'))
  symlinkSync(dirname(dirname(require.resolve('dotenv'))), join(root, 'api/node_modules/dotenv'))
  mkdirSync(join(root, 'api/node_modules/@t-box'))
  symlinkSync(dirname(dirname(fileURLToPath(import.meta.resolve('@t-box/errors')))), join(root, 'api/node_modules/@t-box/errors'))
  copyFileSync(new URL('../src/config.ts', import.meta.url), join(root, 'api/src/config.ts'))
  copyFileSync(new URL('../src/error-codes.ts', import.meta.url), join(root, 'api/src/error-codes.js'))
  writeFileSync(join(root, 'api/package.json'), '{"type":"module"}')
  writeFileSync(join(root, 'api/.env'), 'MYSQL_HOST=127.0.0.1:3306\nMYSQL_USERNAME=fixture\nMYSQL_PASSWORD=file-password\nMYSQL_DATABASE=t_box_fixture\n')
  if (metadata) {
    writeFileSync(join(root, 'release-info.json'), JSON.stringify(metadata))
  }
  return (env: Record<string, string> = {}, storage = false) => {
    const source = `import { getConfig, applicationSettings, resourceStorageSettings } from ${JSON.stringify(pathToFileURL(join(root, 'api/src/config.ts')).href)}; console.log(JSON.stringify({ config: getConfig(), applications: applicationSettings(), resources: ${storage ? 'resourceStorageSettings()' : 'undefined'} }))`
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', env })
    assert.equal(child.status, 0, child.stderr)
    return JSON.parse(child.stdout)
  }
}

test('minimal local configuration opens origins and trusts only the local proxy by default', (t) => {
  const read = fixture(t)
  const { config, applications } = read()
  assert.deepEqual(config.corsOrigins, ['*'])
  assert.deepEqual(config.adminOrigins, ['*'])
  assert.deepEqual(config.trustedProxies, ['127.0.0.1', '::1'])
  assert.equal(config.mysql.password, 'file-password')
  assert.equal(config.redis, undefined)
  assert.deepEqual(applications, { origin: 'http://localhost:6176', delivery: 'local', importOrigin: '', importPrefix: 'builds' })
})

test('business storage requires server credentials in production and inherits only public release settings', (t) => {
  const read = fixture(t, { format: 'tbox-pm2-v1', resourceRegion: 'cn-hangzhou', resourceBucket: 'tboxos' })
  assert.throws(() => read({ NODE_ENV: 'production' }, true), /OSS_ACCESS_KEY_ID/)
  assert.throws(() => read({ OSS_ACCESS_KEY_ID: 'fixture' }, true), /OSS_ACCESS_KEY_SECRET/)
  const configured = read({ NODE_ENV: 'production', OSS_ACCESS_KEY_ID: 'fixture', OSS_ACCESS_KEY_SECRET: 'fixture-secret' }, true)
  assert.deepEqual(configured.resources, { region: 'cn-hangzhou', bucket: 'tboxos', accessKeyId: 'fixture', accessKeySecret: 'fixture-secret' })
  const overridden = read({ OSS_REGION: 'oss-cn-shanghai', OSS_RESOURCE_BUCKET: 'other-bucket', OSS_ACCESS_KEY_ID: 'fixture', OSS_ACCESS_KEY_SECRET: 'fixture-secret', OSS_SESSION_TOKEN: 'fixture-sts' }, true)
  assert.equal(overridden.resources.region, 'cn-shanghai')
  assert.equal(overridden.resources.bucket, 'other-bucket')
  assert.equal(overridden.resources.stsToken, 'fixture-sts')
  assert.equal(fixture(t)({}, true).resources, undefined)
})

test('production reads public applications settings from the packaged Actions metadata', (t) => {
  const read = fixture(t, { format: 'tbox-pm2-v1', adminOrigin: 'https://admin.example.com', artifactOrigin: 'https://apps.example.com', artifactDelivery: 'oss', artifactImportOrigin: 'https://tboxos-app.oss-cn-hangzhou.aliyuncs.com', artifactImportPrefix: 'builds' })
  const { config, applications } = read({ NODE_ENV: 'production' })
  assert.deepEqual(config.adminOrigins, ['https://admin.example.com'])
  assert.deepEqual(applications, { origin: 'https://apps.example.com', delivery: 'oss', importOrigin: 'https://tboxos-app.oss-cn-hangzhou.aliyuncs.com', importPrefix: 'builds' })
  const overridden = read({ APP_ARTIFACT_ORIGIN: 'https://other.example.com', APP_IMPORT_OSS_ORIGIN: '', TRUSTED_PROXIES: '', MYSQL_PASSWORD: 'process-password', ADMIN_ORIGINS: 'https://admin.example.com' })
  assert.equal(overridden.applications.origin, 'https://other.example.com')
  assert.equal(overridden.applications.importOrigin, '')
  assert.deepEqual(overridden.config.trustedProxies, [])
  assert.deepEqual(overridden.config.adminOrigins, ['https://admin.example.com'])
  assert.equal(overridden.config.mysql.password, 'process-password')
})

test('production without deployment metadata denies cross-origin administration and rejects wildcard overrides', (t) => {
  const read = fixture(t)
  assert.deepEqual(read({ NODE_ENV: 'production' }).config.adminOrigins, [])
  assert.throws(() => read({ NODE_ENV: 'production', ADMIN_ORIGINS: '*' }), /ADMIN_ORIGINS/)
  assert.deepEqual(read({ NODE_ENV: 'production', ADMIN_ORIGINS: 'https://admin.example.com' }).config.adminOrigins, ['https://admin.example.com'])
})
