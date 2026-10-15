import type { ApplicationUpdateInfo, MarketEntry } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateUpdatePrompt } from '@t-box/app-contracts'
import { availableUpdate, UpdatePromptRegistry } from '../src/core/app-runtime/updatePrompts'

const info: ApplicationUpdateInfo = { appId: 'calculator', name: '计算器', installedVersion: '1.0.0', version: '1.1.0', releaseId: 'new', releaseNotes: '改进计算', prompt: { mode: 'custom' } }
test('only an active, settled installation prompts; installed release owns the UI policy, including rollbacks', () => {
  const entry = { release: { appId: 'calculator', releaseId: 'new', manifest: { name: '计算器', version: '1.1.0' }, updatePrompt: { mode: 'custom' } }, installation: { status: 'active', releaseId: 'old', version: '1.0.0', operationId: null, targetReleaseId: null } } as MarketEntry
  assert.equal(availableUpdate(entry)?.prompt.mode, 'default')
  assert.equal(availableUpdate({ ...entry, installedUpdatePrompt: { mode: 'custom' } })?.prompt.mode, 'custom')
  assert.equal(availableUpdate({ ...entry, release: { ...entry.release, manifest: { ...entry.release.manifest, version: '0.9.0' } } })?.version, '0.9.0')
  for (const installation of [null, { ...entry.installation!, status: 'failed' as const }, { ...entry.installation!, operationId: 'pending' }, { ...entry.installation!, targetReleaseId: 'new' }, { ...entry.installation!, releaseId: 'new' }]) {
    assert.equal(availableUpdate({ ...entry, installation }), null)
  }
})
test('custom presentation can register during the grace period; acknowledgements are app and owner scoped', async () => {
  const registry = new UpdatePromptRegistry(100)
  const owner = {}
  const pending = registry.request(info)
  let promptId = ''
  registry.register('calculator', owner, 'handler', (event) => {
    promptId = event.promptId
  })
  assert.ok(promptId)
  assert.equal(registry.respond('other', owner, promptId, true), false)
  assert.equal(registry.respond('calculator', {}, promptId, true), false)
  assert.equal(registry.respond('calculator', owner, promptId, true), true)
  assert.equal(await pending, true)
  assert.equal(registry.respond('calculator', owner, promptId, true), false)
  registry.unregister('calculator', owner)
})
test('missing, failing, timed out, or disposed custom UI falls back; late acknowledgements cannot hide defaults', async () => {
  for (const mode of ['missing', 'throw', 'timeout', 'disposed']) {
    const registry = new UpdatePromptRegistry(15)
    const owner = {}
    let promptId = ''
    let cancelled = false
    if (mode !== 'missing') {
      registry.register('calculator', owner, 'handler', (event) => {
        promptId = event.promptId
        if (event.update === null) {
          cancelled = true
        } else if (mode === 'throw') {
          throw new Error('broken app')
        }
      })
    }
    const pending = registry.request(info)
    if (mode === 'disposed') {
      registry.unregister('calculator', owner)
    }
    assert.equal(await pending, false, mode)
    assert.equal(registry.respond('calculator', owner, promptId, true), false)
    if (mode !== 'missing') {
      assert.equal(cancelled, true)
    }
  }
})
test('a new target or navigation cancels visible custom UI; stale cleanup cannot remove its replacement', async () => {
  const registry = new UpdatePromptRegistry(100)
  const owner = {}
  const received: { promptId: string, update: ApplicationUpdateInfo | null }[] = []
  registry.register('calculator', owner, 'first', (event) => received.push(event))
  const first = registry.request(info)
  const firstId = received[0]!.promptId
  registry.respond('calculator', owner, firstId, true)
  assert.equal(await first, true)
  registry.register('calculator', owner, 'second', (event) => received.push(event))
  assert.equal(received.at(-1)!.update, null)
  registry.unregister('calculator', owner, 'first')
  const next = registry.request({ ...info, releaseId: 'newer' })
  const nextId = received.at(-1)!.promptId
  assert.equal(registry.respond('calculator', owner, firstId, true), false)
  assert.equal(registry.respond('calculator', owner, nextId, true), true)
  assert.equal(await next, true)
  registry.cancel('calculator')
  assert.equal(received.at(-1)!.update, null)
})
test('update metadata accepts bounded declarative strings, never executable UI or arbitrary policy fields', () => {
  assert.doesNotThrow(() => validateUpdatePrompt({ mode: 'custom', title: '新版本', description: '查看更新说明' }))
  for (const invalid of [null, [], { mode: 'auto' }, { mode: 'default', script: 'run()' }, { mode: 'custom', title: 'x'.repeat(61) }, { mode: 'default', description: {} }]) {
    assert.throws(() => validateUpdatePrompt(invalid))
  }
})
