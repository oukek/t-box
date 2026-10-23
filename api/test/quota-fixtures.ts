import type { BillingService } from '../src/billing/service.js'
/** Test-only configuration helpers. Never seed selling prices into a developer/production database. */
function disposable(billing: BillingService) {
  if (
    !/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(
      String(billing.source.options.database),
    )
  ) {
    throw new Error('Quota fixtures require a disposable t_box_test_* database')
  }
}
export async function enableTestTariff(billing: BillingService) {
  disposable(billing)
  const current = await billing.catalog.tariff()
  if (!current.enabled) {
    const { version, publishedAt: _at, ...configuration } = current
    await billing.catalog.publishTariff(
      { ...configuration, enabled: true },
      version,
      'test-administrator',
    )
  }
}
export async function paymentSelection(
  billing: BillingService,
  bonusQuota = '0',
) {
  disposable(billing)
  const old = (await billing.catalog.list()).find(
    (row) => row.draft.code === 'test-payment',
  )
  const draft = {
    code: 'test-payment',
    name: '测试商品',
    price: '10.00',
    quota: '10',
    bonusQuota,
    validDays: 180,
    description: '',
    sort: 999,
    enabled: true,
  }
  const id = await billing.catalog.save(draft, old?.id, old?.revision)
  const saved = (await billing.catalog.list()).find((row) => row.id === id)!
  await billing.catalog.publish(id, saved.revision)
  return { packageId: id, version: (saved.published?.version ?? 0) + 1 }
}
