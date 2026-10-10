import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigurationCache } from '../src/configuration/cache.js'
import { platformDefinitions } from '../src/configuration/defaults.js'
import { modelParameters } from '../src/configuration/model-parameters.js'
import {
  ConfigurationStore,
  validateConfiguration,
} from '../src/configuration/store.js'

test('platform catalog excludes application configuration and rejects registration before database access', async () => {
  assert.ok(
    platformDefinitions.every(
      (definition) => !definition.key.startsWith('apps.'),
    ),
  )
  const store = new ConfigurationStore({} as any)
  await assert.rejects(
    store.register([
      {
        key: 'apps.notes.setting',
        group: '应用',
        title: '设置',
        description: '不应注册',
        type: 'text',
        defaultValue: 'value',
        effect: 'new_task',
      },
    ]),
    /Invalid configuration key/,
  )
})
test('revision keys isolate late fills and cached values do not alias caller objects', async () => {
  const values = new Map<string, string>()
  const cache = new ConfigurationCache({
    isReady: true,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value)
    },
  })
  let finish!: (value: { name: string }) => void
  const old = cache.read(
    'test',
    1,
    () =>
      new Promise<{ name: string }>((resolve) => {
        finish = resolve
      }),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(await cache.read('test', 2, async () => ({ name: 'new' })), {
    name: 'new',
  })
  finish({ name: 'old' })
  await old
  const next = await cache.read<{ name: string }>('test', 2, async () => {
    throw new Error('cache miss')
  })
  assert.equal(next.name, 'new')
  next.name = 'mutated'
  assert.equal(
    (await cache.read('test', 2, async () => ({ name: 'wrong' }))).name,
    'new',
  )
})
test('Redis failure and invalid JSON fall back to authoritative configuration', async () => {
  for (const get of [
    async () => {
      throw new Error('offline')
    },
    async () => 'broken-json',
    async () => new Promise<string | null>(() => {}),
  ]) {
    const cache = new ConfigurationCache({
      isReady: true,
      get,
      set: async () => {
        throw new Error('offline')
      },
    })
    assert.deepEqual(
      await cache.read('test', 1, async () => ({ valid: true })),
      { valid: true },
    )
  }
})
test('configuration validation rejects unknown types and unsafe budgets', () => {
  const retries = platformDefinitions.find(
    (d) => d.key === 'ai.retry.maxRetries',
  )!
  assert.equal(validateConfiguration(retries, 5), 5)
  for (const value of [6, -1, 1.5, '5', Infinity]) {
    assert.throws(() => validateConfiguration(retries, value), {
      code: 'INVALID_CONFIGURATION',
    })
  }
  const temperature = platformDefinitions.find(
    (d) => d.key === 'ai.parameters.temperature',
  )!
  assert.equal(validateConfiguration(temperature, 0.7), 0.7)
})
test('optional model parameters remain omitted until enabled', () => {
  assert.deepEqual(modelParameters(), {})
  const snapshot = {
    revision: 1,
    values: {
      'ai.parameters.temperatureEnabled': true,
      'ai.parameters.temperature': 0.7,
      'ai.parameters.topPEnabled': false,
      'ai.parameters.reasoningEffort': 'high',
    },
  }
  assert.deepEqual(modelParameters(snapshot, false), { temperature: 0.7 })
  assert.deepEqual(modelParameters(snapshot, true), {
    temperature: 0.7,
    effort: 'high',
  })
})
