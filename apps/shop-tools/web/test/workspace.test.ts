import type { AppClient } from '@t-box/app-sdk'
import type {
  WorkspaceHeader,
  WorkspacePatch,
  WorkspaceState,
} from '@t-box/shop-tools-contracts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clone,
  defaultConfig,
  diffWorkspace,
  metadataOf,
  newRow,
  newSheet,
} from '../../core/src/index.js'
import { createWorkspaceStore } from '../src/workspace.js'

function state(): WorkspaceState {
  const sheet = newSheet('测试', defaultConfig().basic)
  return {
    book: { version: 1, activeSheetId: sheet.id, sheets: [sheet] },
    config: defaultConfig(),
    detail: null,
    comparison: null,
  }
}
function fixture() {
  let revision = 0
  let failAfterCommit = false
  const receipts = new Map<string, { revision: number }>()
  const requests: { args: WorkspacePatch, key: string }[] = []
  const header: WorkspaceHeader = {
    revision: 0,
    metadata: null,
    config: null,
    history: null,
  }
  const client = {
    storage: {
      get: () => {
        throw new Error('local storage must not be used')
      },
      set: () => {
        throw new Error('local storage must not be used')
      },
    },
    api: {
      invoke: async (
        method: string,
        args: WorkspacePatch,
        options?: { idempotencyKey: string },
      ) => {
        if (method === 'workspace_get') {
          return { ...header, revision }
        }
        if (method === 'workspace_rows') {
          return { items: [], nextOffset: null }
        }
        assert.equal(method, 'workspace_patch')
        const key = options!.idempotencyKey
        requests.push({ args: clone(args), key })
        if (receipts.has(key)) {
          return receipts.get(key)
        }
        if (args.revision !== revision) {
          throw Object.assign(new Error('conflict'), { code: 'SHOP_CONFLICT' })
        }
        revision++
        const receipt = { revision }
        receipts.set(key, receipt)
        if (failAfterCommit) {
          failAfterCommit = false
          throw new Error('response lost')
        }
        return receipt
      },
    },
  } as unknown as AppClient
  return {
    client,
    requests,
    get revision() {
      return revision
    },
    get fail() {
      return failAfterCommit
    },
    set fail(value: boolean) {
      failAfterCommit = value
    },
    advance() {
      revision++
    },
  }
}
test('cloud saves only changed rows and config, never browser storage', async () => {
  const f = fixture()
  const store = createWorkspaceStore(f.client)
  const initial = state()
  await store.load()
  await store.save(initial)
  assert.equal(f.requests.length, 1)
  f.requests.length = 0
  await store.save(clone(initial))
  assert.equal(f.requests.length, 0)
  const next = clone(initial)
  next.book.sheets[0]!.rows[2]!.cost = '99'
  await store.save(next)
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0]?.args.upserts.length, 1)
  assert.equal(f.requests[0]?.args.config, undefined)
  f.requests.length = 0
  next.config.basic.loss = 0
  await store.save(next)
  assert.equal(f.requests[0]?.args.upserts.length, 0)
  assert.equal(f.requests[0]?.args.config?.basic.loss, 0)
})
test('unknown write outcome reuses identical receipt key before saving newer edits', async () => {
  const f = fixture()
  const store = createWorkspaceStore(f.client)
  const initial = state()
  await store.load()
  f.fail = true
  await assert.rejects(() => store.save(initial), /response lost/)
  const next = clone(initial)
  next.book.sheets[0]!.rows[0]!.name = '新修改'
  await store.save(next)
  assert.equal(f.requests[0]?.key, f.requests[1]?.key)
  assert.deepEqual(f.requests[0]?.args, f.requests[1]?.args)
  assert.equal(f.revision, 2)
  assert.equal(f.requests[2]?.args.upserts[0]?.row.name, '新修改')
})
test('conflicts stop writes until explicit reload instead of overwriting newer data', async () => {
  const f = fixture()
  const store = createWorkspaceStore(f.client)
  const initial = state()
  await store.load()
  await store.save(initial)
  f.advance()
  initial.config.basic.loss = 0
  await assert.rejects(() => store.save(initial), { code: 'SHOP_CONFLICT' })
  const count = f.requests.length
  await assert.rejects(() => store.save(initial), { code: 'SHOP_CONFLICT' })
  assert.equal(f.requests.length, count)
  await store.load()
  await store.save(initial)
  assert.equal(f.requests.at(-1)?.args.revision, 2)
})
test('a concurrent update during paginated load restarts the read at one revision', async () => {
  const value = state()
  const meta = metadataOf(value)
  let headers = 0
  let pages = 0
  const client = {
    api: {
      invoke: async (method: string, args: { revision: number }) => {
        if (method === 'workspace_get') {
          return {
            revision: ++headers,
            metadata: meta,
            config: value.config,
            history: null,
          }
        }
        if (++pages === 1) {
          throw Object.assign(new Error('changed'), { code: 'SHOP_CONFLICT' })
        }
        assert.equal(args.revision, 2)
        return {
          items: [
            {
              sheetId: value.book.activeSheetId,
              position: 0,
              row: value.book.sheets[0]!.rows[0],
            },
          ],
          nextOffset: null,
        }
      },
    },
  } as unknown as AppClient
  const result = await createWorkspaceStore(client).load()
  assert.equal(headers, 2)
  assert.equal(result?.book.sheets[0]?.rows.length, 1)
})
test('loading failures never create an empty fallback workspace', async () => {
  const client = {
    api: {
      invoke: async () => {
        throw new Error('offline')
      },
    },
  } as unknown as AppClient
  await assert.rejects(() => createWorkspaceStore(client).load(), /offline/)
})
test('large Unicode imports split below the transport byte limit', () => {
  const value = state()
  value.book.sheets[0]!.rows = Array.from({ length: 130 }, () => ({
    ...newRow(value.config.basic),
    name: '商品'.repeat(1000),
    sku: '编号'.repeat(1000),
  }))
  const patches = diffWorkspace(null, value)
  assert.ok(patches.length > 2)
  assert.equal(
    patches.reduce((n, p) => n + p.upserts.length, 0),
    130,
  )
  for (const p of patches) {
    assert.ok(new TextEncoder().encode(JSON.stringify(p)).byteLength < 700000)
  }
})
