import type { AppClient } from '@t-box/app-sdk'
import type {
  ProductPage,
  WorkspaceHeader,
  WorkspacePatch,
  WorkspaceState,
} from '@t-box/shop-tools-contracts'
import { ShopError } from '@t-box/shop-tools-contracts'
import {
  clone,
  diffWorkspace,
  validateBook,
  validateConfig,
} from '@t-box/shop-tools-core'

export function createWorkspaceStore(client: AppClient) {
  let revision = 0
  let baseline: WorkspaceState | null = null
  let pending: {
    target: WorkspaceState
    patches: {
      patch: Omit<WorkspacePatch, 'revision'>
      key: string
      request?: WorkspacePatch
    }[]
    index: number
  } | null = null
  let conflicted = false
  async function load(): Promise<WorkspaceState | null> {
    // A concurrent save between pages invalidates the entire read, never mixes revisions.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const header = await client.api.invoke<WorkspaceHeader>(
          'workspace_get',
          {},
        )
        if (!header.metadata) {
          revision = header.revision
          baseline = null
          pending = null
          conflicted = false
          return null
        }
        const sheets = header.metadata.sheets.map((s) => ({
          ...s,
          rows: [] as WorkspaceState['book']['sheets'][number]['rows'],
        }))
        let offset: number | null = 0
        while (offset !== null) {
          const page: ProductPage = await client.api.invoke<ProductPage>(
            'workspace_rows',
            { revision: header.revision, offset },
          )
          for (const item of page.items) {
            const sheet = sheets.find((s) => s.id === item.sheetId)
            if (!sheet) {
              throw ShopError.invalid('云端商品所属工作表不存在')
            }
            sheet.rows.push(item.row)
          }
          if (page.nextOffset !== null && page.nextOffset <= offset) {
            throw ShopError.invalid('云端商品分页无效')
          }
          offset = page.nextOffset
        }
        const state: WorkspaceState = {
          book: validateBook({
            version: 1,
            activeSheetId: header.metadata.activeSheetId,
            sheets,
          }),
          config: validateConfig(header.config),
          detail: header.history?.detail ?? null,
          comparison: header.history?.comparison ?? null,
        }
        revision = header.revision
        baseline = clone(state)
        pending = null
        conflicted = false
        return state
      } catch (error) {
        if (
          (error as { code?: string }).code === 'SHOP_CONFLICT' &&
          attempt < 2
        ) {
          continue
        }
        throw error
      }
    }
    throw ShopError.conflict()
  }
  async function finish() {
    if (!pending) {
      return
    }
    while (pending.index < pending.patches.length) {
      const item = pending.patches[pending.index]!
      item.request ??= { ...item.patch, revision }
      try {
        const result = await client.api.invoke<{ revision: number }>(
          'workspace_patch',
          item.request,
          { idempotencyKey: item.key },
        )
        revision = result.revision
        pending.index++
      } catch (e) {
        if ((e as { code?: string }).code === 'SHOP_CONFLICT') {
          conflicted = true
        }
        throw e
      }
    }
    baseline = clone(pending.target)
    pending = null
  }
  async function save(state: WorkspaceState) {
    if (conflicted) {
      throw ShopError.conflict()
    }
    await finish()
    const patches = diffWorkspace(baseline, state)
    if (!patches.length) {
      return
    }
    pending = {
      target: clone(state),
      index: 0,
      patches: patches.map((patch) => ({ patch, key: crypto.randomUUID() })),
    }
    await finish()
  }
  return { load, save }
}
