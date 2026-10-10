import type { DataSource } from 'typeorm'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  rechargeBonusCents,
  rechargeCents,
  rechargeOfferBonusCents,
} from '@t-box/shared'
import { BillingPricingService } from '../src/billing/pricing.js'
import {
  parseRechargeConfiguration,
  RechargeSettingsService,
  upgradeRechargeConfiguration,
} from '../src/payments/recharge.js'

test('recharge cents validate the one-yuan floor and exact two-decimal amounts', () => {
  for (const value of [
    '0',
    '0.99',
    '1.001',
    '10000.01',
    '1e3',
    '-1',
    'NaN',
    10,
    null,
  ]) {
    assert.equal(rechargeCents(value), null)
  }
  assert.equal(rechargeCents('1'), 100)
  assert.equal(rechargeCents('1.01'), 101)
  assert.equal(rechargeCents('9999.99'), 999999)
  assert.equal(rechargeCents('10000.00'), 1000000)
})
test('bonus takes the highest reached threshold and applies to custom amounts without stacking', () => {
  const rules = [
    { threshold: '100', bonus: '20.01' },
    { threshold: '10', bonus: '1' },
  ]
  assert.equal(rechargeBonusCents(999, rules), 0)
  assert.equal(rechargeBonusCents(1000, rules), 100)
  assert.equal(rechargeBonusCents(9999, rules), 100)
  assert.equal(rechargeBonusCents(12345, rules), 2001)
})
const preset = (amount: string, bonusAmount = '0', enabled = true) => ({
  amount,
  bonusAmount,
  enabled,
})
test('package benefits override thresholds and disabled custom recharge rejects arbitrary amounts', () => {
  const config = {
    presets: [
      preset('10', '0.01'),
      preset('100', '5'),
      preset('50', '999', false),
    ],
    customEnabled: false,
    bonusRules: [{ threshold: '1', bonus: '20' }],
    minAmount: '1',
    maxAmount: '10000',
  }
  assert.equal(rechargeOfferBonusCents(1000, config), 1)
  assert.equal(rechargeOfferBonusCents(10000, config), 500)
  assert.equal(rechargeOfferBonusCents(1010, config), null)
  assert.equal(rechargeOfferBonusCents(5000, config), null)
  assert.equal(rechargeOfferBonusCents(0, config), null)
  config.customEnabled = true
  assert.equal(rechargeOfferBonusCents(1010, config), 2000)
  assert.equal(rechargeOfferBonusCents(10000, config), 500)
})
test('admin settings validate independent package bonuses, switches and duplicate amounts', () => {
  const value = {
    presets: [preset('10'), preset('1.01', '0.01')],
    bonusRules: [{ threshold: '10', bonus: '0.01' }],
    customEnabled: false,
  }
  assert.deepEqual(parseRechargeConfiguration(value), {
    presets: [preset('1.01', '0.01'), preset('10.00', '0.00')],
    bonusRules: [{ threshold: '10.00', bonus: '0.01' }],
    customEnabled: false,
    minAmount: '1',
    maxAmount: '10000',
  })
  for (const bad of [
    { ...value, customEnabled: undefined },
    { ...value, customEnabled: 'false' },
    { ...value, presets: [preset('10'), preset('10.00')] },
    { ...value, presets: [preset('0.99')] },
    { ...value, presets: [preset('10', '-1')] },
    { ...value, presets: [preset('10', '0.001')] },
    { ...value, presets: [preset('10', '10000.01')] },
    {
      ...value,
      presets: [{ amount: '10', bonusAmount: '0', enabled: 'false' }],
    },
    { ...value, bonusRules: [{ threshold: '10', bonus: '0' }] },
    { ...value, bonusRules: [{ threshold: '10', bonus: '0.001' }] },
    { ...value, bonusRules: [{ threshold: '10', bonus: '10000.01' }] },
    {
      ...value,
      bonusRules: [
        { threshold: '10', bonus: '1' },
        { threshold: '10.00', bonus: '2' },
      ],
    },
    { ...value, enabled: true },
  ]) {
    assert.throws(() => parseRechargeConfiguration(bad))
  }
  assert.equal(
    parseRechargeConfiguration({ ...value, presets: [] }).presets.length,
    0,
  )
})
test('legacy migration preserves per-package gifts but closes custom recharge by default', () => {
  const config = upgradeRechargeConfiguration({
    presets: ['10', '50', '100'],
    bonusRules: [
      { threshold: '30', bonus: '3' },
      { threshold: '100', bonus: '20' },
    ],
  })
  assert.equal(config.customEnabled, false)
  assert.deepEqual(config.presets, [
    preset('10.00', '0.00'),
    preset('50.00', '3.00'),
    preset('100.00', '20.00'),
  ])
  assert.deepEqual(
    upgradeRechargeConfiguration({ ...config, customEnabled: true }),
    { ...config, customEnabled: true },
  )
})
test('public settings hide offline packages and metadata; stale edits and bypass amounts are rejected', async () => {
  let revision = 3
  const configuration = {
    presets: [preset('10'), preset('50', '2', false)],
    bonusRules: [],
    customEnabled: false,
    minAmount: '1',
    maxAmount: '10000',
  }
  const service = new RechargeSettingsService({
    getRepository: () => ({
      async findOneBy() {
        return {
          configuration,
          revision,
          updatedAt: null,
          updatedBy: 'private-admin',
        }
      },
      async update(where: { revision: number }) {
        if (where.revision !== revision) {
          return { affected: 0 }
        }
        revision++
        return { affected: 1 }
      },
    }),
  } as unknown as DataSource)
  assert.deepEqual((await service.publicConfiguration()).presets, [
    preset('10'),
  ])
  assert.equal(await service.bonusCents(1000), 0)
  await assert.rejects(service.bonusCents(1001), {
    code: 'CUSTOM_RECHARGE_DISABLED',
  })
  await assert.rejects(service.bonusCents(5000), {
    code: 'CUSTOM_RECHARGE_DISABLED',
  })
  const patch = {
    presets: [preset('10')],
    bonusRules: [],
    customEnabled: false,
    revision: 3,
  }
  await assert.rejects(service.save({ ...patch, revision: 2 }, 'admin'), {
    code: 'CONFIGURATION_CHANGED',
  })
  assert.equal((await service.save(patch, 'admin')).revision, 4)
  await assert.rejects(service.save(patch, 'admin'), {
    code: 'CONFIGURATION_CHANGED',
  })
})
test('public AI schedule only projects active service prices, never model names or credentials', async () => {
  let query = ''
  const service = new BillingPricingService({
    async query(sql: string) {
      query = sql
      return [
        {
          purpose: 'conversation',
          inputPrice: '1.5',
          outputPrice: '3',
          imagePrice: '0',
          model: 'secret-model',
          apiKey: 'secret-key',
        },
        {
          purpose: 'image',
          inputPrice: '0',
          outputPrice: '0',
          imagePrice: '0.25',
          provider: 'secret-provider',
        },
      ]
    },
  } as unknown as DataSource)
  const schedule = await service.schedule()
  assert.deepEqual(schedule, {
    currency: 'CNY',
    tokenUnit: 1000000,
    titleFree: true,
    conversation: { inputPrice: '1.500000', outputPrice: '3.000000' },
    image: { imagePrice: '0.250000' },
  })
  assert(!JSON.stringify(schedule).includes('secret'))
  assert(query.includes('m.enabled=1 AND p.enabled=1'))
  assert(!query.includes('key_cipher'))
  const empty = new BillingPricingService({
    async query() {
      return []
    },
  } as unknown as DataSource)
  assert.equal((await empty.schedule()).conversation, null)
  assert.equal((await empty.schedule()).image, null)
})
