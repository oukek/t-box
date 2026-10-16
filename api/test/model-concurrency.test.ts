import type { DataSource } from 'typeorm'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ProviderConcurrency } from '../src/billing/concurrency.js'

function leaseFixture(options: { failAcquisition?: number, failRelease?: number }) {
  let transactions = 0
  let releases = 0
  const query = async (sql: string) => {
    if (sql.startsWith('SELECT id FROM ai_provider_leases')) {
      return []
    }
    if (sql.startsWith('DELETE FROM ai_provider_leases WHERE id=')) {
      releases++
      if (releases <= (options.failRelease || 0)) {
        throw Object.assign(new Error('fixture deadlock'), { code: 'ER_LOCK_DEADLOCK' })
      }
      return { affectedRows: 1 }
    }
    if (sql.includes('COUNT(*)')) {
      return [{ count: 0 }]
    }
    if (sql.includes('SELECT max_concurrency')) {
      return [{ max_concurrency: 1 }]
    }
    return []
  }
  const source = {
    query,
    async transaction(_isolation: string, work: (db: { query: typeof query }) => Promise<unknown>) {
      transactions++
      if (transactions <= (options.failAcquisition || 0)) {
        throw Object.assign(new Error('fixture acquire deadlock'), { code: 'ER_LOCK_DEADLOCK' })
      }
      return work({ query })
    },
  } as unknown as DataSource
  return { pool: new ProviderConcurrency(source), transactions: () => transactions, releases: () => releases }
}
test('Lease deadlock retry replays only the transaction, never the model callback', async () => {
  const { pool, transactions, releases } = leaseFixture({ failAcquisition: 1, failRelease: 1 })
  let requests = 0
  const result = await pool.run('fixture', new AbortController().signal, undefined, async () => {
    requests++
    return 'known successful result'
  })
  assert.equal(result, 'known successful result')
  assert.equal(requests, 1)
  assert.equal(transactions(), 2)
  assert.equal(releases(), 2)
})
test('Exhausted lease cleanup cannot replace the provider outcome or cause an upstream retry', async (t) => {
  const logs: unknown[][] = []
  t.mock.method(console, 'warn', (...args: unknown[]) => {
    logs.push(args)
  })
  const { pool, releases } = leaseFixture({ failRelease: 99 })
  assert.equal(await pool.run('fixture', new AbortController().signal, undefined, async () => 'settled'), 'settled')
  assert.equal(releases(), 3)
  assert.equal(logs[0]?.[0], 'MODEL_SLOT_RELEASE_FAILED')
  const rejected = leaseFixture({ failRelease: 99 })
  const original = new Error('original provider failure')
  await assert.rejects(rejected.pool.run('fixture', new AbortController().signal, undefined, async () => {
    throw original
  }), (error) => error === original)
})
