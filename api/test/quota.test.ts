import assert from 'node:assert/strict'
import test from 'node:test'
import { prices, supplierCost } from '../src/billing/money.js'
import {
  packageDraft,
  tariffInput,
} from '../src/billing/quota/catalog.js'
import {
  initialPackages,
  initialTariff,
} from '../src/billing/quota/defaults.js'
import { quota, quotaFee, quotaText } from '../src/billing/quota/math.js'

test('credits use exact integer atoms and cache does not duplicate input tokens', () => {
  assert.equal(quotaText(quota('123.0001')), '123.0001')
  assert.equal(quotaText(-1n), '-0.0001')
  const tariff = {
    ...initialTariff,
    inputPerMillion: '250',
    cachedInputPerMillion: '25',
    outputPerMillion: '1000',
  }
  assert.equal(
    quotaFee(tariff, {
      inputTokens: 1000,
      cachedInputTokens: 800,
      outputTokens: 100,
    }),
    1700n,
  )
  assert.equal(quotaFee(tariff, { inputTokens: 1 }), 3n)
  assert.throws(() =>
    quotaFee(tariff, { inputTokens: 1, cachedInputTokens: 2 }),
  )
  for (const invalid of ['-1', '1e3', '1.00001', 2, null, 'NaN']) {
    assert.throws(() => quota(invalid))
  }
})
test('image editing and generation have independent integer credit tiers', () => {
  const tariff = {
    ...initialTariff,
    edits: { '1k': '15', '2k': '25', '4k': '35' },
  }
  assert.equal(quotaFee(tariff, { images: 3, tier: '4k' }), quota('90'))
  assert.equal(
    quotaFee(tariff, { images: 1, tier: '2k', editing: true }),
    quota('25'),
  )
})
test('supplier discount affects cost only, not public fee', () => {
  assert.equal(
    supplierCost(1234567n, prices({ costMultiplier: '0.8' })),
    987654n,
  )
  assert.throws(() => prices({ costMultiplier: '0' }))
  assert.throws(() => prices({ costMultiplier: '10.1' }))
})
test('package and tariff inputs reject unknown fields, fractional product credits and stale assumptions', () => {
  assert.deepEqual(packageDraft(initialPackages[0]), initialPackages[0])
  for (const invalid of [
    { quota: '1.1' },
    { bonusQuota: '-1' },
    { validDays: 0 },
    { price: '0' },
    { price: '0.001' },
    { price: '9.999' },
    { enabled: 'true' },
  ]) {
    assert.throws(() => packageDraft({ ...initialPackages[0], ...invalid }))
  }
  assert.throws(() => packageDraft({ ...initialPackages[0], balance: '10' }))
  const { version: _v, publishedAt: _p, ...configuration } = initialTariff
  assert.deepEqual(tariffInput(configuration), configuration)
  assert.throws(() =>
    tariffInput({ ...configuration, cachedInputPerMillion: '999' }),
  )
  assert.throws(() =>
    tariffInput({
      ...configuration,
      images: { ...configuration.images, '4k': '1.5' },
    }),
  )
})

test('resource packages accept exact prices below one yuan down to one cent', () => {
  for (const [input, expected] of [['0.01', '0.01'], ['0.1', '0.10'], ['0.99', '0.99'], ['1', '1.00']]) {
    assert.equal(packageDraft({ ...initialPackages[0], price: input }).price, expected)
  }
  for (const invalid of ['0', '0.001', '0.009', '-0.01', '10000.01']) {
    assert.throws(() => packageDraft({ ...initialPackages[0], price: invalid }))
  }
})
