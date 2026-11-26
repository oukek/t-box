import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { stageDesktopCandidate } from './desktop-release.mjs'

test('one candidate binds both Mac installers and both update archives after all uploads succeed', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'desktop-staging-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const files = {}
  for (const name of ['ui', 'core', 'intel', 'armDmg', 'intelDmg']) {
    files[name] = path.join(dir, name)
    await writeFile(files[name], name)
    await writeFile(files[name] + '.sig', 'signature-' + name)
  }
  const reservation = { build: 'build', ui: '1.3.2', core: '1.0.3', base: null }
  const uploaded = new Map()
  const client = { async put(key, bytes) {
    uploaded.set(bytes.toString(), key)
  } }
  let candidate
  await stageDesktopCandidate(reservation, files, client, (body) => {
    candidate = body
  })
  assert.equal(uploaded.size, 5)
  for (const [name, artifact, extension] of [
    ['core', candidate.core, 'app.tar.gz'],
    ['intel', candidate.core.distribution.intel, 'app.tar.gz'],
    ['armDmg', candidate.core.distribution.installers.aarch64, 'dmg'],
    ['intelDmg', candidate.core.distribution.installers.x86_64, 'dmg'],
    ['ui', candidate.ui, 'json'],
  ]) {
    assert.equal(artifact.signature, 'signature-' + name)
    assert.equal(uploaded.get(name), 'desktop-candidates/build/' + artifact.digest + '.' + extension)
  }
  await assert.rejects(stageDesktopCandidate(reservation, { ...files, intelDmg: path.join(dir, 'absent') }, client, () => assert.fail('registered an incomplete build')), { code: 'ENOENT' })
})
