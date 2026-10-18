import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { deploymentEnvironment } from '../deploy/settings.mjs'
import { sha256 } from './application-builds.mjs'
import { contentType, ossSettings, publishArtifact, publishBootstrap, publishFiles, publishSite } from './oss-static.mjs'
import { verifiedOffline } from './vite-offline.mjs'
import { prepareWebVerification } from './web-verification.mjs'

const environment = { OSS_REGION: 'cn-hangzhou', OSS_ACCESS_KEY_ID: 'fixture-id', OSS_ACCESS_KEY_SECRET: 'fixture-secret', APP_IMPORT_TOKEN: 'private-import', PM2_SSH_PASSWORD: 'private-password' }
const settings = () => ossSettings('test-public-bucket', 'https://apps.example.com', environment)
const file = (path, value) => ({ path, content: Buffer.from(value).toString('base64') })

test('two public settings provide isolated sites and the fixed OSS layout to every deployment workflow', async () => {
  const generated = deploymentEnvironment({ DEPLOY_DOMAIN: 'example.com', OSS_REGION: 'cn-hangzhou', APPS_OSS_BUCKET: 'obsolete-bucket', APP_IMPORT_API_URL: 'https://untrusted.example', OSS_ENDPOINT: 'https://untrusted.example' })
  assert.deepEqual([generated.WEB_OSS_BUCKET, generated.ADMIN_OSS_BUCKET, generated.APPS_OSS_BUCKET], ['tboxos', 'tboxos-admin', 'tboxos-app'])
  assert.deepEqual([generated.WEB_ORIGIN, generated.ADMIN_ORIGIN, generated.APP_ARTIFACT_ORIGIN, new URL(generated.API_BASE_URL).origin], ['https://example.com', 'https://admin.example.com', 'https://apps.example.com', 'https://api.example.com'])
  assert.equal(generated.APP_IMPORT_API_URL, 'https://api.example.com/api/v1/application-builds')
  assert.equal(generated.OSS_ENDPOINT, 'https://oss-cn-hangzhou.aliyuncs.com')
  assert.equal(generated.OSS_BUCKET, generated.ADMIN_OSS_BUCKET)
  assert.equal(generated.APP_OSS_PREFIX, 'builds')
  assert.equal(generated.OSS_PREFIX, 'docker')
  for (const name of ['web-oss', 'application-release', 'api-pm2', 'api-image']) {
    const workflow = await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8')
    assert.deepEqual([...new Set([...workflow.matchAll(/\$\{\{ vars\.(\w+)/g)].map((match) => match[1]))].sort(), ['DEPLOY_DOMAIN', 'OSS_REGION'], name)
    assert.ok(workflow.includes('run: node deploy/settings.mjs'), name)
    assert.ok(!workflow.includes('secrets.OSS_SESSION_TOKEN'), name)
  }
})

test('invalid deployment domains and regions fail before destinations can be generated', () => {
  for (const domain of ['', 'localhost', '127.0.0.1', 'https://example.com', 'example.com/path', 'example.com:443', 'example.com\nMALICIOUS=value', '-example.com', 'example.com.']) {
    assert.throws(() => deploymentEnvironment({ DEPLOY_DOMAIN: domain, OSS_REGION: 'cn-hangzhou' }), /DEPLOY_DOMAIN/)
  }
  for (const region of ['', 'oss-cn-hangzhou', 'cn-hangzhou-internal', '../region', 'cn-hangzhou\nMALICIOUS=value']) {
    assert.throws(() => deploymentEnvironment({ DEPLOY_DOMAIN: 'example.com', OSS_REGION: region }), /OSS_REGION/)
  }
})

test('the settings CLI exports only derived public values and its output passes website and bootstrap preflights', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tbox-deployment-settings-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const githubEnv = join(directory, 'github-env')
  await writeFile(githubEnv, 'EXISTING=value\n')
  const input = { ...process.env, ...environment, DEPLOY_DOMAIN: 'tboxos.cn', GITHUB_ENV: githubEnv }
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../deploy/settings.mjs', import.meta.url))], { encoding: 'utf8', env: input })
  assert.equal(result.status, 0, result.stderr)
  const exported = await readFile(githubEnv, 'utf8')
  assert.ok(exported.startsWith('EXISTING=value\n'))
  assert.ok(!exported.includes(environment.OSS_ACCESS_KEY_SECRET))
  assert.ok(!exported.includes(environment.APP_IMPORT_TOKEN))
  assert.ok(!result.stdout.includes(environment.PM2_SSH_PASSWORD))
  const generated = Object.fromEntries(exported.trim().split('\n').map((line) => line.split('=')))
  assert.equal(generated.WEB_ORIGIN, 'https://tboxos.cn')
  assert.equal(generated.API_BASE_URL, 'https://api.tboxos.cn/api/v1')
  for (const args of [['deploy-web-oss.mjs', 'all', '--check'], ['upload-bootstrap-oss.mjs', '--check']]) {
    const checked = spawnSync(process.execPath, [fileURLToPath(new URL(args[0], import.meta.url)), ...args.slice(1)], { encoding: 'utf8', env: { ...input, ...generated } })
    assert.equal(checked.status, 0, checked.stderr)
  }
})

test('website preflight rejects a shared bucket even when publishing only one site', () => {
  const run = (extra) => spawnSync(process.execPath, [fileURLToPath(new URL('./deploy-web-oss.mjs', import.meta.url)), 'app', '--check'], {
    encoding: 'utf8',
    env: { ...process.env, ...environment, API_BASE_URL: 'https://api.example.com/api/v1', WEB_ORIGIN: 'https://example.com', ADMIN_ORIGIN: 'https://admin.example.com', APP_ARTIFACT_ORIGIN: 'https://apps.example.com', WEB_OSS_BUCKET: 'test-web-bucket', ADMIN_OSS_BUCKET: 'test-admin-bucket', APPS_OSS_BUCKET: 'test-apps-bucket', ...extra },
  })
  assert.equal(run({}).status, 0)
  assert.notEqual(run({ ADMIN_OSS_BUCKET: 'test-web-bucket' }).status, 0)
  assert.notEqual(run({ API_BASE_URL: 'http://api.example.com/api/v1' }).status, 0)
})
function storage({ corrupt = false, missing = false } = {}) {
  const objects = new Map()
  const calls = []
  return {
    objects,
    calls,
    options: {
      run: async (args, env) => {
        assert.equal(env.APP_IMPORT_TOKEN, undefined)
        assert.equal(env.PM2_SSH_PASSWORD, undefined)
        calls.push(args)
        assert.equal(args[args.indexOf('--acl') + 1], 'public-read')
        objects.set(new URL(args[2]).pathname, await readFile(args[1]))
      },
      request: async (url, options) => {
        assert.equal(options.redirect, 'error')
        assert.equal(options.cache, 'no-store')
        const bytes = objects.get(url.pathname)
        return new Response(corrupt ? 'corrupted' : bytes, { status: missing || !bytes ? 404 : 200 })
      },
    },
  }
}

test('OSS configuration rejects unsafe destinations and removes unrelated credentials', () => {
  assert.equal(settings().environment.OSS_ENDPOINT, 'https://oss-cn-hangzhou.aliyuncs.com')
  for (const origin of ['http://apps.example.com', 'https://apps.example.com/', 'https://user:password@apps.example.com', 'https://apps.example.com/path', 'https://apps.example.com?x=1']) {
    assert.throws(() => ossSettings('test-bucket', origin, environment))
  }
  assert.throws(() => ossSettings('../bucket', 'https://apps.example.com', environment))
  assert.throws(() => ossSettings('test-bucket', 'https://apps.example.com', { ...environment, OSS_ENDPOINT: 'https://evil.example' }))
  assert.throws(() => ossSettings('test-bucket', 'https://apps.example.com', { OSS_REGION: 'cn-hangzhou' }))
  assert.equal(contentType('.well-known/apple-app-site-association'), 'application/json')
})

test('website dependencies precede HTML and the service worker; metadata controls cache and MIME', async () => {
  const remote = storage()
  await publishFiles([file('index.html', 'html'), file('tbox-offline-sw.js', 'worker'), file('assets/main-Abc12345.js', 'script'), file('tbox-offline.js', 'register')], settings(), remote.options)
  assert.deepEqual(remote.calls.map((args) => new URL(args[2]).pathname), ['/assets/main-Abc12345.js', '/tbox-offline.js', '/index.html', '/tbox-offline-sw.js'])
  assert.equal(remote.calls[0].at(-1), 'public,max-age=31536000,immutable')
  assert.equal(remote.calls[2].at(-1), 'no-cache')
  assert.ok(remote.calls[2].includes('text/html; charset=utf-8'))
  assert.ok(remote.calls.every((args) => !args.includes('rm') && !args.includes('--delete')))
})

test('a missing or changed remote dependency prevents entrypoint publication', async () => {
  for (const failure of [{ corrupt: true }, { missing: true }]) {
    const remote = storage(failure)
    await assert.rejects(publishFiles([file('index.html', 'html'), file('assets/main.js', 'script')], settings(), remote.options))
    assert.equal(remote.calls.length, 1)
    assert.equal(remote.objects.has('/index.html'), false)
  }
})

test('immutable application files and canonical manifest publish before version registration', async () => {
  const files = [file('index.html', 'html'), file('assets/main.js', 'script')]
  const hashes = Object.fromEntries(files.map((entry) => [entry.path, sha256(Buffer.from(entry.content, 'base64'))]).sort(([a], [b]) => a.localeCompare(b)))
  const digest = sha256(JSON.stringify(hashes))
  const remote = storage()
  await publishArtifact('calendar', digest, files, settings(), remote.options)
  assert.equal(remote.calls.at(-1)[2], `oss://test-public-bucket/calendar/${digest}/artifact.json`)
  assert.ok(remote.calls.every((args) => args.at(-1).includes('immutable')))
  const manifest = JSON.parse(remote.objects.get(`/calendar/${digest}/artifact.json`))
  assert.deepEqual(manifest, { protocol: 1, appId: 'calendar', digest, files: hashes })
  await assert.rejects(publishArtifact('calendar', '0'.repeat(64), files, settings(), remote.options), /digest/)
})

test('unsafe paths, duplicate files, secrets and symlinks cannot reach OSS', async (t) => {
  const remote = storage()
  for (const path of ['../private', '.env', 'nested/.env.production', 'private.key', 'assets/a.js.map', '.secrets/key', 'index.html']) {
    await assert.rejects(publishFiles([file('index.html', 'html'), file(path, 'secret')], settings(), remote.options))
  }
  assert.equal(remote.calls.length, 0)
  const root = await mkdtemp(join(tmpdir(), 'tbox-oss-links-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'index.html'), 'html')
  await symlink(join(root, 'index.html'), join(root, 'linked.html'))
  await assert.rejects(publishSite(root, settings(), remote.options), /symlinks/)
})

test('PM2 bootstrap uploads exactly the packaged application digest', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tbox-oss-bootstrap-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = { 'index.html': sha256('bootstrap') }
  const digest = sha256(JSON.stringify(files))
  const directory = join(root, 'calculator', digest)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'index.html'), 'bootstrap')
  await writeFile(join(directory, 'artifact.json'), JSON.stringify({ protocol: 1, appId: 'calculator', digest, files }))
  const remote = storage()
  await publishBootstrap(root, settings(), remote.options)
  assert.equal(remote.calls.length, 2)
  await writeFile(join(directory, 'index.html'), 'tampered')
  await assert.rejects(publishBootstrap(root, settings(), remote.options), /checksum/)
})

test('application CSP is embedded in built HTML for direct OSS hosting', () => {
  const tags = verifiedOffline({ application: true }).transformIndexHtml()
  const csp = tags.find((tag) => tag.attrs['http-equiv'] === 'Content-Security-Policy')
  assert.ok(csp.attrs.content.includes('form-action \'none\''))
  assert.ok(csp.attrs.content.includes('connect-src \'self\''))
  assert.equal(csp.injectTo, 'head-prepend')
  assert.equal(verifiedOffline().transformIndexHtml().some((tag) => tag.tag === 'meta'), false)
})

test('WeChat AASA publication preserves other applications and requires the frontend HTTPS domain', async (t) => {
  const { WEB_ORIGIN: webOrigin } = deploymentEnvironment({ DEPLOY_DOMAIN: 'tboxos.cn', OSS_REGION: 'cn-hangzhou' })
  const root = await mkdtemp(join(tmpdir(), 'tbox-oss-wechat-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dist = join(root, 'dist')
  await mkdir(join(root, 'capacitor/ios/App/App.xcodeproj'), { recursive: true })
  await mkdir(join(dist, '.well-known'), { recursive: true })
  await writeFile(join(root, 'capacitor/wechat.config.json'), JSON.stringify({ enabled: true, appId: 'wx1234567890abcdef', iosTeamId: 'ABCDEFGHIJ', universalLink: webOrigin + '/wechat/' }))
  await writeFile(join(root, 'capacitor/ios/App/App.xcodeproj/project.pbxproj'), 'PRODUCT_BUNDLE_IDENTIFIER = com.tbox.app;')
  await writeFile(join(dist, '.well-known/apple-app-site-association'), JSON.stringify({ applinks: { details: [{ appID: 'OTHER.app', paths: ['/other/*'] }] } }))
  await prepareWebVerification(root, dist, webOrigin)
  await prepareWebVerification(root, dist, webOrigin)
  const result = JSON.parse(await readFile(join(dist, '.well-known/apple-app-site-association'), 'utf8'))
  assert.deepEqual(result.applinks.details, [{ appID: 'OTHER.app', paths: ['/other/*'] }, { appID: 'ABCDEFGHIJ.com.tbox.app', paths: ['/wechat/*'] }])
  await assert.rejects(prepareWebVerification(root, dist, 'https://box.tboxos.cn'), /WEB_ORIGIN/)
  await assert.rejects(prepareWebVerification(root, dist, 'https://other.example.com'), /WEB_ORIGIN/)
})
