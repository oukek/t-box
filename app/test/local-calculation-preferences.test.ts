import type { ApplicationContext } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createAppClient } from '@t-box/app-sdk'
import { restoreHistory, saveHistory } from '../../apps/calculator/web/src/history'
import { runtime as calculator } from '../../apps/calculator/web/src/runtime'
import { configureRuntime, identity, loadPreferences, preferences } from '../../apps/time/web/src/runtime'

function fixture(subject: string) {
  const pending = new Map<string, (value: unknown) => void>()
  const client = createAppClient({
    call: async (_method, args) => new Promise((resolve) => {
      pending.set(String(args.key), resolve)
    }),
    listen: () => () => {},
    close: () => {},
  })
  const context: ApplicationContext = { sdkVersion: 1, appId: 'time', releaseId: 'time-1', generation: 1, subject, platform: 'web', runtime: 'web', params: {}, permissions: ['storage'], capabilities: ['storage.get', 'storage.set'] }
  configureRuntime(client, context)
  return { client, pending }
}

test('late preference restoration preserves a stopwatch started and clocks changed while the bridge was pending', async () => {
  const f = fixture('time-local')
  try {
    const loaded = loadPreferences()
    preferences.clocks = ['UTC']
    preferences.stopwatch = { elapsed: 5, startedAt: 1000, laps: [] }
    f.pending.get('time.clocks.v1')!(['Asia/Tokyo'])
    f.pending.get('time.stopwatch.v1')!({ elapsed: 999, startedAt: null, laps: [] })
    await loaded
    assert.deepEqual(preferences.clocks, ['UTC'])
    assert.deepEqual(preferences.stopwatch, { elapsed: 5, startedAt: 1000, laps: [] })
    assert.equal(preferences.loaded, true)
  } finally {
    f.client.dispose()
  }
})

test('account switch discards a previous account preference response', async () => {
  const a = fixture('old-time-account')
  const loaded = loadPreferences()
  const b = fixture('new-time-account')
  try {
    a.pending.get('time.clocks.v1')!(['UTC'])
    a.pending.get('time.stopwatch.v1')!({ elapsed: 123, startedAt: null, laps: [] })
    await loaded
    assert.equal(identity.user?.id, 'new-time-account')
    assert.equal(preferences.loaded, false)
    assert.equal(preferences.clocks, null)
    assert.equal(preferences.stopwatch, null)
  } finally {
    a.client.dispose()
    b.client.dispose()
  }
})

test('calculator history restoration cannot undo a clear or contaminate a different account', () => {
  calculator.subject = 'calculator-user'
  calculator.historyRevision = 0
  calculator.initialHistory = null
  restoreHistory('calculator-user', ['old-record'], 0)
  assert.deepEqual(calculator.initialHistory, ['old-record'])
  saveHistory('calculator-user', [])
  restoreHistory('calculator-user', ['late-old-record'], 0)
  assert.deepEqual(calculator.initialHistory, [])
  calculator.subject = 'next-calculator-user'
  restoreHistory('calculator-user', ['foreign-record'], calculator.historyRevision)
  assert.deepEqual(calculator.initialHistory, [])
})
