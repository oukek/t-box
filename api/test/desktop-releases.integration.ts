import type { DesktopArtifact } from '../src/db/records/system-versions.js'
import type { Component } from '../src/system-releases/desktop-artifacts.js'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buffer } from 'node:stream/consumers'
import Fastify from 'fastify'
import JSZip from 'jszip'
import { createConnection } from 'mysql2/promise'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { initializeDatabase } from '../src/db/initialize.js'
import { databaseSchemas } from '../src/db/schema/index.js'
import { artifactKey } from '../src/system-releases/desktop-artifacts.js'
import {
  desktopPlan,
  desktopTrialUrl,
  publishDesktop,
  registerDesktop,
} from '../src/system-releases/desktop-candidates.js'
import { registerDesktopUpdates } from '../src/system-releases/desktop-routes.js'
import { desktopUiTrial } from '../src/system-releases/desktop-ui-trial.js'
import { reserveSystemVersions } from '../src/system-releases/reserve.js'
import { promoteWebCandidate, registerWebCandidate } from '../src/system-releases/web-candidates.js'
import { assertDisposableDatabase } from './fixtures.js'

const config = getConfig().mysql
assertDisposableDatabase(config.database)
const database = 't_box_test_desktop_' + randomUUID().replaceAll('-', '')
const { database: _database, ...options } = config
const admin = await createConnection(options)
const db = createDataSource({ ...config, database })
const objects = new Map<string, Buffer>()
const store = {
  async read(kind: Component, item: DesktopArtifact) {
    const b = objects.get(artifactKey(kind, item))
    if (!b) {
      throw new Error('missing')
    }
    return b
  },
  url: async (kind: Component, item: DesktopArtifact) =>
    'https://example.test/' + artifactKey(kind, item),
}
const tmp = mkdtempSync(path.join(tmpdir(), 'desktop-release-'))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
function signer(kind: Component) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const id = randomBytes(8)
  const publicPacket = Buffer.concat([
    Buffer.from('Ed'),
    id,
    publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
  ]).toString('base64')
  process.env[kind === 'ui' ? 'TBOX_UI_PUBLIC_KEY' : 'TBOX_CORE_PUBLIC_KEY'] =
    Buffer.from('untrusted comment: test\n' + publicPacket).toString('base64')
  return (data: Buffer, version: string) => {
    const s = sign(
      null,
      createHash('blake2b512').update(data).digest(),
      privateKey,
    )
    const comment = 'timestamp:1\tversion:' + version
    const packet = Buffer.concat([Buffer.from('ED'), id, s]).toString('base64')
    const global = sign(
      null,
      Buffer.concat([s, Buffer.from(comment)]),
      privateKey,
    ).toString('base64')
    return Buffer.from(
      [
        'untrusted comment: test',
        packet,
        'trusted comment: ' + comment,
        global,
      ].join('\n'),
    ).toString('base64')
  }
}
const uiSign = signer('ui')
const coreSign = signer('core')
let batch = 0
const reserve = (choices: Record<string, string>) =>
  reserveSystemVersions(db, {
    batch: 'fixture/tbox/' + ++batch,
    commit: 'a'.repeat(40),
    channel: 'macos',
    ...choices,
  })
function makeUi(build: string, version: string, protocol = 1) {
  const b = Buffer.from(
    JSON.stringify({ version, protocol, files: { 'index.html': 'YQ==' } }),
  )
  const item = { build, version, digest: sha(b), signature: uiSign(b, version) }
  objects.set(artifactKey('ui', item), b)
  return item
}
function makeCore(
  build: string,
  version: string,
  ui: DesktopArtifact,
  arch = 0x0100000C,
) {
  const app = 'T方舟.app'
  const contents = path.join(tmp, app, 'Contents')
  for (const dir of ['MacOS', 'Resources']) {
    mkdirSync(path.join(contents, dir), { recursive: true })
  }
  const bin = Buffer.alloc(32)
  bin.writeUInt32LE(0xFEEDFACF)
  bin.writeUInt32LE(arch, 4)
  writeFileSync(path.join(contents, 'MacOS/tbox-desktop'), bin)
  writeFileSync(
    path.join(contents, 'Info.plist'),
    '<key>CFBundleIdentifier</key><string>cn.tboxos.desktop</string><key>CFBundleShortVersionString</key><string>' +
    version +
    '</string>',
  )
  writeFileSync(
    path.join(contents, 'Resources/desktop-release.json'),
    JSON.stringify({ protocol: 1, uiDigest: ui.digest, uiVersion: ui.version }),
  )
  execFileSync('tar', [
    '--format',
    'ustar',
    '-czf',
    path.join(tmp, 'core.tgz'),
    '-C',
    tmp,
    app,
  ])
  const b = readFileSync(path.join(tmp, 'core.tgz'))
  const item = {
    build,
    version,
    digest: sha(b),
    signature: coreSign(b, version),
  }
  objects.set(artifactKey('core', item), b)
  return item
}
try {
  await admin.query('CREATE DATABASE ??', [database])
  await db.initialize()
  await initializeDatabase(db, databaseSchemas)
  const a = await reserve({ ui: '1.1.17', core: '1.0.2' })
  const ui = makeUi(a.build, a.ui!)
  const body = {
    build: a.build,
    base: null,

    ui,
    core: makeCore(a.build, a.core!, ui),
  }
  const register = (value: unknown) => registerDesktop(db, value, store)
  const publish = (id: string, base: string | null) =>
    publishDesktop(db, id, base, 'tester', '第一项\n第二项', store)
  const plan = (ui: string, core: string) =>
    desktopPlan(db, { platform: 'macos', arch: 'aarch64', ui, core }, store)
  await assert.rejects(register({ ...body, core: null }))
  await assert.rejects(
    register({ ...body, core: makeCore(a.build, a.core!, ui, 0x01000007) }),
  )
  await assert.rejects(
    register({ ...body, ui: { ...ui, signature: body.core.signature } }),
  )
  const incompatible = makeUi(a.build, a.ui!, 2)
  await assert.rejects(register({ ...body, ui: incompatible, core: makeCore(a.build, a.core!, incompatible) }))
  const duplicates = await Promise.all([register(body), register(body)])
  assert.equal(duplicates[0].build, duplicates[1].build)
  assert.equal(await desktopTrialUrl(db, a.build, store), await store.url('core', body.core))
  await assert.rejects(register({ ...body, notes: '同一编号已经登记其他说明' }))
  assert.equal(await plan('1.0.0', '1.0.0'), null)
  await assert.rejects(publishDesktop(db, a.build, null, 'tester', '  ', store), { code: 'VALIDATION_ERROR', details: { notes: '请填写更新内容' } })
  await publish(a.build, null)
  assert.equal((await register(body)).notes, '第一项\n第二项\n优化修复 bug')
  assert.ok((await plan('1.0.0', '1.0.0'))?.core)
  assert.equal((await plan('1.1.9', '1.0.2'))?.ui?.bytes, objects.get(artifactKey('ui', ui))!.length)
  const b = await reserve({ ui: 'patch' })
  const c = await reserve({ core: 'patch' })
  const nextUi = makeUi(b.build, b.ui!)
  const coreBody = {
    build: c.build,
    base: a.build,
    notes: '核心',
    core: makeCore(c.build, c.core!, ui),
  }
  await register({ build: b.build, base: a.build, notes: '界面', ui: nextUi })
  await register(coreBody)
  assert.equal(await desktopTrialUrl(db, c.build, store), await store.url('core', coreBody.core))
  await assert.rejects(desktopTrialUrl(db, b.build, store))
  await assert.rejects(desktopTrialUrl(db, a.build, store))
  const trial = await JSZip.loadAsync(await buffer(await desktopUiTrial(db, b.build, store)))
  assert.deepEqual(await trial.file('resources/core.app.tar.gz')!.async('nodebuffer'), objects.get(artifactKey('core', body.core)))
  assert.deepEqual(await trial.file('resources/ui.json')!.async('nodebuffer'), objects.get(artifactKey('ui', nextUi)))
  const trialState = JSON.parse(await trial.file('resources/state.json')!.async('string'))
  assert.deepEqual(trialState.active, { version: nextUi.version, digest: nextUi.digest, signature: nextUi.signature })
  const launcher = trial.file('启动体验版.command')!
  assert.ok(Number(launcher.unixPermissions) & 0o100)
  execFileSync('sh', ['-n'], { input: await launcher.async('string') })
  assert.equal((await plan('1.0.0', '1.0.0'))?.id, a.build)
  await publish(b.build, a.build)
  await assert.rejects(desktopUiTrial(db, b.build, store))
  await assert.rejects(publish(c.build, a.build))
  assert.equal((await plan('1.1.17', '1.0.2'))?.core, null)
  const h = await reserve({ core: 'patch' })
  const core = makeCore(h.build, h.core!, nextUi)
  await register({ build: h.build, base: b.build, notes: '核心', core })
  const key = artifactKey('core', core)
  const good = objects.get(key)!
  objects.delete(key)
  await assert.rejects(publish(h.build, b.build))
  objects.set(key, good)
  await publish(h.build, b.build)
  const result = await plan(b.ui!, a.core!)
  assert.equal(result?.notes, '第一项\n第二项\n优化修复 bug')
  assert.equal(result?.ui, null)
  assert.equal(result?.core?.version, h.core)
  assert.equal(result?.core?.bytes, good.length)
  assert.equal(await plan(b.ui!, h.core!), null)
  const server = Fastify()
  registerDesktopUpdates(server, db, store)
  try {
    const base = '/api/v1/system-updates'
    const response = await server.inject(base + '?platform=macos&arch=aarch64&ui=1.1.18&core=1.0.2')
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['cache-control'], 'no-store')
    assert.equal(response.json().id, h.build)
    const manifest = await server.inject(base + '/' + h.build + '/core')
    assert.equal(manifest.json().signature, core.signature)
    assert.equal((await server.inject(base + '/' + a.build + '/core')).statusCode, 404)
    const installer = await server.inject(base + '/macos/aarch64/installer')
    assert.equal(installer.statusCode, 302)
    assert.equal(installer.headers.location, manifest.json().url)
    assert.equal((await server.inject(base + '?platform=macos&arch=x86_64&ui=1.0.0&core=1.0.0')).statusCode, 204)
  } finally {
    await server.close()
  }
  // Race distinct approved candidates against the same live release.
  const candidates = await Promise.all([reserve({ ui: 'patch' }), reserve({ ui: 'patch' })])
  for (const r of candidates) {
    await register({ build: r.build, base: h.build, notes: '并发发布', ui: makeUi(r.build, r.ui!) })
  }
  const publication = await Promise.allSettled(candidates.map((r) => publish(r.build, h.build)))
  assert.equal(publication.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(publication.filter((r) => r.status === 'rejected').length, 1)
  const winner = candidates[publication.findIndex((r) => r.status === 'fulfilled')]!
  const stale = candidates.find((r) => r.build !== winner.build)!
  await assert.rejects(desktopUiTrial(db, stale.build, store))
  const jump = await plan('1.0.0', '1.0.0')
  assert.equal(jump?.id, winner.build)
  assert.equal(jump?.ui?.version, winner.ui)
  assert.equal(jump?.core?.version, h.core)
  assert.equal(await plan(winner.ui!, h.core!), null)
  assert.equal(await plan('20.1.0', '1.0.0'), null)
  assert.equal(await plan('1.0.0', '20.1.0'), null)
  const shared = await reserve({ channel: 'shared', ui: '2.1.15' })
  const files = ['index.html', 'tbox-offline-sw.js', 'web-version.json'].map((path) => ({
    path,
    content: Buffer.from(path === 'web-version.json' ? JSON.stringify({ build: shared.build, version: shared.ui }) : 'fixture').toString('base64'),
  }))
  const bytes = Buffer.from(JSON.stringify(files))
  const digest = sha(bytes)
  objects.set('system-candidates/' + shared.build + '/' + digest + '.json', bytes)
  let interrupt = true
  const webStore = {
    async read(key: string) {
      return objects.get(key)!
    },
    async write(key: string, value: Buffer) {
      if (key === 'web-version.json' && interrupt) {
        throw new Error('interrupted')
      }
      objects.set(key, value)
    },
  }
  await registerWebCandidate(db, { build: shared.build, digest }, webStore)
  const approve = () => promoteWebCandidate(db, shared.build, null, 'tester', '统一发布', webStore, store)
  await assert.rejects(approve(), /尚未就绪/)
  await register({ build: shared.build, base: winner.build, ui: makeUi(shared.build, shared.ui!) })
  await assert.rejects(publish(shared.build, winner.build), /统一发布/)
  await assert.rejects(approve(), /发布中断/)
  assert.equal(objects.has('web-version.json'), false)
  assert.equal(await plan(winner.ui!, h.core!), null)
  interrupt = false
  await approve()
  await approve()
  const marker = JSON.parse(objects.get('web-version.json')!.toString())
  const update = await plan(winner.ui!, h.core!)
  assert.equal(marker.build, shared.build)
  assert.equal(update?.id, marker.build)
  assert.equal(update?.ui?.version, marker.version)
  assert.equal(update?.notes, marker.notes)
  assert.equal(update?.core, null)
  console.info(
    '通过：联合、仅界面、仅核心，缺包、签名、错误架构、并发基线和发布前隔离',
  )
} finally {
  if (db.isInitialized) {
    await db.destroy()
  }
  await admin.query('DROP DATABASE IF EXISTS ??', [database])
  await admin.end()
  rmSync(tmp, { recursive: true, force: true })
}
