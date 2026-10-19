import type { ApplicationPackage, ResourceJournal } from '../src/core/app-runtime/resources/contracts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLaunchReport } from '../../api/src/application-platform/launch-report'
import { applicationPackage, ApplicationResourceManager } from '../src/core/app-runtime/resources/manager'

function pkg(version: string): ApplicationPackage {
  const digest = version.repeat(64)
  return { appId: 'notes', releaseId: `notes-${version}`, digest, entryUrl: `https://apps.test/notes/${digest}/` }
}
function fixture() {
  let saved: ResourceJournal | undefined
  const prepared = new Set<string>()
  let calls = 0
  let broken = false
  const manager = new ApplicationResourceManager({
    async prepare(value) {
      calls++
      if (broken) {
        throw new Error('download failed')
      }
      prepared.add(value.digest)
      return 'ready'
    },
    async open(value) {
      assert.ok(prepared.has(value.digest))
      return { entryUrl: value.entryUrl, origin: 'https://apps.test', source: 'local' }
    },
    async remove(value) {
      prepared.delete(value.digest)
    },
  }, { read: () => saved && structuredClone(saved), write: (value) => {
    saved = structuredClone(value)
  } })
  return { manager, prepared, get calls() {
    return calls
  }, break() {
    broken = true
  } }
}
test('package identity is content addressed; unversioned, redirected and unsafe resource URLs cannot become local packages', () => {
  assert.equal(applicationPackage({ ...pkg('a'), integrity: `sha256-${pkg('a').digest}` })?.digest, pkg('a').digest)
  assert.equal(applicationPackage({ ...pkg('a'), integrity: 'sha256-' + '0'.repeat(64) }), undefined)
  for (const entryUrl of ['https://evil.test/x/', `${pkg('a').entryUrl}?credentials=secret`, `https://user:password@apps.test/notes/${pkg('a').digest}/`]) {
    assert.throws(() => applicationPackage({ ...pkg('a'), entryUrl, integrity: `sha256-${pkg('a').digest}` }))
  }
})
test('background preparation does not activate or overwrite a healthy version; failed downloads preserve it', async () => {
  const f = fixture()
  await f.manager.open(pkg('a'))
  f.manager.healthy('alice', pkg('a'))
  await f.manager.prepare(pkg('b'))
  assert.equal(f.manager.fallback('alice', 'notes', 'b')?.releaseId, 'notes-a')
  assert.equal(f.manager.fallback('bob', 'notes', 'b'), undefined)
  f.break()
  await assert.rejects(f.manager.prepare(pkg('c')))
  assert.equal(f.manager.fallback('alice', 'notes', 'c')?.releaseId, 'notes-a')
  assert.ok(f.prepared.has(pkg('a').digest))
})
test('bad version is quarantined without a retry loop, repair clears it, actual cache readiness is rechecked after eviction', async () => {
  const f = fixture()
  await f.manager.open(pkg('a'))
  f.manager.healthy('alice', pkg('a'))
  await f.manager.open(pkg('b'))
  f.manager.quarantine(pkg('b'))
  await assert.rejects(f.manager.open(pkg('b')), /启动失败/)
  await f.manager.repair(pkg('b'))
  await f.manager.open(pkg('b'))
  f.manager.healthy('alice', pkg('b'))
  assert.equal(f.manager.fallback('alice', 'notes', 'notes-b')?.releaseId, 'notes-a')
  const before = f.calls
  f.prepared.clear()
  assert.equal((await f.manager.open(pkg('b'))).source, 'local')
  assert.equal(f.calls, before + 1)
})
test('concurrent prefetch and foreground open share the same preparation', async () => {
  const f = fixture()
  await Promise.all([f.manager.prepare(pkg('a')), f.manager.prepare(pkg('a')), f.manager.open(pkg('a'))])
  assert.equal(f.calls, 1)
})
test('launch reports accept only bounded timings and public identifiers, never prompts, tokens or arbitrary stage data', () => {
  const value = { id: 'launch-1', appId: 'notes', releaseId: 'notes-a', source: 'local', platform: 'ios', outcome: 'ready', totalMs: 180, stages: { resolving: 20, preparing: 15, loading: 100, connecting: 45 }, createdAt: new Date().toISOString() }
  assert.deepEqual(parseLaunchReport(value, 'notes').stages, value.stages)
  for (const input of [{ ...value, token: 'secret' }, { ...value, stages: { prompt: 'private' } }, { ...value, totalMs: Infinity }, { ...value, source: 'filesystem/path' }, { ...value, stages: { loading: -1 } }]) {
    assert.throws(() => parseLaunchReport(input, 'notes'))
  }
})

test('recovery never commits after account/navigation changes, does not fake pending success and prevents loops', async () => {
  const { LaunchRecovery } = await import('../src/core/app-runtime/resources/recovery')
  const f = fixture()
  f.manager.healthy('alice', pkg('a'))
  const runtime = { ...pkg('b'), integrity: `sha256-${pkg('b').digest}`, origin: 'https://apps.test', protocol: 1 as const, generation: 1, subject: 'alice', permissions: [], clientTools: [] }
  let live = true
  let calls = 0
  const cancelled = new LaunchRecovery(f.manager)
  const result = await cancelled.recover(runtime, { current: () => live, started: () => {
    live = false
  }, rollback: async () => {
    calls++
    return { status: 'completed' }
  } })
  assert.equal(result, false)
  assert.equal(calls, 0)
  const pending = new LaunchRecovery(f.manager)
  assert.equal(await pending.recover(runtime, { current: () => true, started() {}, rollback: async () => ({ status: 'pending' }) }), false)
  assert.equal(f.manager.journal().quarantined.length, 0)
  const recovery = new LaunchRecovery(f.manager)
  const ports = { current: () => true, started() {}, rollback: async () => {
    calls++
    return { status: 'completed' }
  } }
  assert.equal(await recovery.recover(runtime, ports), true)
  assert.equal(await recovery.recover(runtime, ports), false)
  assert.equal(calls, 1)
  assert.ok(f.manager.journal().quarantined.includes(pkg('b').entryUrl))
})

test('opening the current version keeps its background update package and prunes only older unused versions', async () => {
  const f = fixture()
  await f.manager.open(pkg('a'))
  f.manager.healthy('alice', pkg('a'))
  await f.manager.prepare(pkg('b'))
  await f.manager.open(pkg('a'))
  f.manager.healthy('alice', pkg('a'))
  await Promise.resolve()
  assert.ok(f.prepared.has(pkg('b').digest), 'foreground access must not evict a preloaded update')
  await f.manager.prepare(pkg('c'))
  await f.manager.prepare(pkg('d'))
  f.manager.healthy('alice', pkg('a'))
  await Promise.resolve()
  assert.ok(f.prepared.has(pkg('a').digest))
  assert.ok(f.prepared.has(pkg('d').digest))
  assert.ok(!f.prepared.has(pkg('b').digest))
  assert.ok(!f.prepared.has(pkg('c').digest))
})
