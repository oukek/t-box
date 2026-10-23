import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publicRunError } from '../src/chat/errors.js'
import { imageModelPrices, imageModelTiers, imageRequestSize, imageTier, storedImagePrices, storedImageTiers } from '../src/models/image-tier.js'

test('unspecified or null image resolution is 1K; invalid tiers never become provider requests', () => {
  assert.equal(imageTier(undefined), '1k')
  assert.equal(imageTier(null), '1k')
  for (const tier of ['1k', '2k', '4k']) {
    assert.equal(imageTier(tier), tier)
  }
  for (const invalid of ['auto', '8k', '', 1024, {}, []]) {
    assert.throws(() => imageTier(invalid), { code: 'IMAGE_TIER_INVALID' })
  }
})

test('default 1K never uses automatic/high-resolution sizing; higher tiers ignore the 1K canvas preference', () => {
  assert.equal(imageRequestSize('1k'), '1024x1024')
  assert.equal(imageRequestSize('1k', 'auto'), '1024x1024')
  assert.equal(imageRequestSize('1k', '4096x4096'), '1024x1024')
  assert.equal(imageRequestSize('1k', '1024x1536'), '1024x1536')
  assert.equal(imageRequestSize('1k', '1536x1024'), '1536x1024')
  assert.equal(imageRequestSize('2k', '1024x1536'), '2048x2048')
  assert.equal(imageRequestSize('4k', 'auto'), '4096x4096')
})

test('invalid image resolution is a configuration failure, not a provider retry', () => {
  try {
    imageTier('8k')
    assert.fail('Invalid tier accepted')
  } catch (error) {
    assert.equal(publicRunError(error).retryable, false)
  }
})

test('model capabilities require a non-empty unique subset, normalized for stable caching', () => {
  assert.deepEqual(imageModelTiers(undefined), ['1k'])
  assert.deepEqual(imageModelTiers(['4k', '2k']), ['2k', '4k'])
  assert.deepEqual(storedImageTiers('["2k","4k"]'), ['2k', '4k'])
  for (const invalid of [[], null, '2k', '["2k"]', ['auto'], ['1k', '1k'], [null], ['2k', '8k'], {}]) {
    assert.throws(() => imageModelTiers(invalid), { code: 'IMAGE_TIER_INVALID' })
  }
})

test('per-tier procurement prices preserve zero, validate amounts, and remove unsupported overrides', () => {
  assert.deepEqual(imageModelPrices({ '1k': '0', '2k': '0.25', '4k': '' }, ['1k', '2k', '4k']), { '1k': '0.000000', '2k': '0.250000' })
  assert.deepEqual(storedImagePrices('{"2k":"0.25","4k":"0.5"}', ['2k', '4k']), { '2k': '0.250000', '4k': '0.500000' })
  assert.deepEqual(imageModelPrices({ '2k': '0.2', '4k': '0.4' }, ['2k']), { '2k': '0.200000' })
  assert.deepEqual(imageModelPrices(null, ['1k']), {})
  for (const value of [{ '8k': '1' }, { '2k': -1 }, { '2k': '-1' }, { '2k': '1.1234567' }, [], '1']) {
    assert.throws(() => imageModelPrices(value, ['2k']))
  }
})
