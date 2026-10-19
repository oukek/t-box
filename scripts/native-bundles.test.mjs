import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { sha256 } from './application-builds.mjs'
import { bundleNativeApplications } from './bundle-native-applications.mjs'

async function fixture(t, kind = 'system') {
  const root = await mkdtemp(join(tmpdir(), 'tbox-native-bundle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const put = async (path, value) => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), value)
  }
  await put('package.json', '{"type":"module"}')
  await put('apps/math/build.config.json', JSON.stringify({ appId: 'math', package: '@t-box/math-web', releasePackage: '@t-box/math-server', releaseModule: 'server/dist/release.js', releaseExport: 'mathRelease', native: { bundled: true, guest: true } }))
  await put('apps/math/web/package.json', JSON.stringify({ name: '@t-box/math-web', scripts: { build: 'vite build' } }))
  await put('apps/math/server/package.json', JSON.stringify({ name: '@t-box/math-server', type: 'module', scripts: { build: 'tsc' } }))
  await put('apps/math/web/index.html', '<title>Math</title>')
  await put('apps/math/web/dist/index.html', '<html>offline math</html>')
  await put('apps/math/web/dist/assets/app.js', 'console.info("local")')
  await put('apps/math/server/dist/release.js', `export const mathRelease = ${JSON.stringify({ appId: 'math', protocol: 1, releaseId: 'math-1', manifest: { id: 'math', version: '1.0.0' }, kind, defaultInstalled: true, platforms: ['web', 'ios', 'android'], runtime: { type: 'web' } })}`)
  return { root, put }
}
test('native bundle generation verifies exact packaged bytes and builds a public baseline index', async (t) => {
  const f = await fixture(t)
  const releases = await bundleNativeApplications(f.root)
  const digest = releases[0].runtime.integrity.slice(7)
  const base = join(f.root, 'capacitor/bundled-applications/math', digest)
  const json = await readFile(join(base, 'tbox-package-files.json'), 'utf8')
  assert.equal(sha256(json), digest)
  for (const [path, hash] of Object.entries(JSON.parse(json))) {
    assert.equal(sha256(await readFile(join(base, path))), hash)
  }
  const index = JSON.parse(await readFile(join(f.root, 'capacitor/bundled-applications/index.json'), 'utf8'))
  assert.equal(index.applications[0].releaseId, releases[0].releaseId)
  assert.equal(new URL(index.applications[0].runtime.entryUrl).origin, 'https://bundled.tbox.invalid')
})
test('user apps cannot gain shipped system/guest privileges; failed packaging preserves an existing bundle', async (t) => {
  const f = await fixture(t, 'user')
  await f.put('capacitor/bundled-applications/index.json', 'previous bundle')
  await assert.rejects(bundleNativeApplications(f.root), /system/)
  assert.equal(await readFile(join(f.root, 'capacitor/bundled-applications/index.json'), 'utf8'), 'previous bundle')
})
test('hidden assets that Android silently drops cannot produce an apparently successful native bundle', async (t) => {
  const f = await fixture(t)
  await f.put('apps/math/web/dist/.vite/manifest.json', '{}')
  await assert.rejects(bundleNativeApplications(f.root), /reserved native/)
})
