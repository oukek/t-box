import type { HostMethod, MarketEntry } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLocalMethod, readLocalCatalog, resolveLocalLaunch, saveLocalCatalog } from '../src/core/app-runtime/localLaunch'
import { clearLocalAccount, readLocalProfile, saveLocalProfile } from '../src/core/localAccount'

export function localEntry(): MarketEntry {
  const release = { appId: 'notes', releaseId: 'notes-1', protocol: 1 as const, kind: 'user' as const, platforms: ['web' as const, 'ios' as const, 'android' as const], defaultInstalled: false, permissions: ['storage', 'files', 'api.request'], clientTools: ['notes_confirm'], backend: { type: 'local' as const, binding: 'notes' }, runtime: { type: 'web' as const, entryUrl: `https://apps.test/notes/${'a'.repeat(64)}/`, integrity: `sha256-${'a'.repeat(64)}` }, manifest: { id: 'notes', name: '笔记', description: 'test', version: '1.0.0', icon: 'apps', color: 'blue', skillIds: [] } }
  return { release, installedRelease: release, installation: { appId: 'notes', releaseId: 'notes-1', targetReleaseId: null, generation: 1, status: 'active', operationId: null, grants: ['storage', 'files', 'api.request'] }, localBinding: { subject: 'b'.repeat(64), storage: true } }
}

test('local launch restores the exact installed version across platforms, and carries no backend grants', () => {
  const entry = localEntry()
  const newer = { ...entry.release, releaseId: 'notes-2' }
  for (const platform of ['web', 'ios', 'android'] as const) {
    const local = resolveLocalLaunch([{ ...entry, release: newer }], 'notes', platform)!
    assert.equal(local.descriptor?.releaseId, 'notes-1')
    assert.equal(local.context.access, 'local')
    assert.deepEqual(local.context.permissions, [])
    assert.equal(local.context.applicationVersion, entry.installedRelease!.manifest.version)
    assert.deepEqual(local.descriptor?.permissions, [])
    assert.ok(local.context.capabilities.includes('storage.set'))
    for (const method of local.context.capabilities) {
      assert.ok(isLocalMethod(method))
    }
  }
  for (const method of ['api.invoke', 'api.request', 'files.pick', 'files.upload', 'files.read', 'events.subscribe', 'device.reminders', 'resources.bindings', 'updates.openMarket'] satisfies HostMethod[]) {
    assert.equal(isLocalMethod(method), false, method)
  }
})
test('missing, mismatched, revoked or malformed installations cannot bootstrap locally', () => {
  const e = localEntry()
  for (const entry of [
    { ...e, localBinding: undefined },
    { ...e, localBinding: { subject: 'invalid', storage: true } },
    { ...e, installation: null },
    { ...e, installation: { ...e.installation!, status: 'revoked' as const } },
    { ...e, installation: { ...e.installation!, releaseId: 'old' } },
    { ...e, installation: { ...e.installation!, generation: -1 } },
  ]) {
    assert.equal(resolveLocalLaunch([entry], 'notes', 'web'), undefined)
  }
  assert.equal(resolveLocalLaunch([{ ...e, localBinding: { ...e.localBinding!, storage: false } }], 'notes', 'web')?.context.capabilities.includes('storage.get'), false)
})
test('device snapshots isolate accounts, strip grants, ignore corruption and clear on logout', () => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
  try {
    saveLocalProfile({ id: 'alice', username: 'alice', nickname: 'A', createdAt: '2026-01-01' })
    assert.equal(readLocalProfile()?.id, 'alice')
    saveLocalCatalog('alice', [localEntry()])
    assert.deepEqual(readLocalCatalog('alice')[0]?.installation?.grants, [])
    assert.deepEqual(readLocalCatalog('bob'), [])
    assert.doesNotMatch([...values.values()].join(''), /Bearer|password|accessToken/)
    clearLocalAccount('alice')
    assert.deepEqual(readLocalCatalog('alice'), [])
    assert.equal(readLocalProfile(), null)
    for (const key of ['tbox.applications.local-catalog.v1.alice', 'tbox.identity.local-profile.v1']) {
      values.set(key, '{broken')
    }
    assert.deepEqual(readLocalCatalog('alice'), [])
    assert.equal(readLocalProfile(), null)
  } finally {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
