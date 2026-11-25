import type { AppClient } from '@t-box/app-sdk'
import type { Item, Saved } from '@t-box/todo-contracts'
import { ref } from 'vue'

export function useItems(client: AppClient) {
  const rows = ref<Saved[]>([])
  const busy = ref(false)
  const ready = ref(false)
  const error = ref('')
  let knownVersion: number | undefined
  let retry: { body: string, key: string } | undefined
  async function load() {
    if (busy.value) {
      return
    }
    busy.value = true
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const found: Saved[] = []
          let cursor: string | null = null
          let version: number | undefined
          do {
            const page: {
              unchanged?: boolean
              rows: Saved[]
              next: string | null
              version: number
            } = await client.api.invoke('list', {
              cursor,
              version,
              knownVersion,
            })
            if (page.unchanged) {
              error.value = ''
              return
            }
            found.push(...page.rows)
            cursor = page.next
            version = page.version
          } while (cursor)
          knownVersion = version
          rows.value = found
          ready.value = true
          error.value = ''
          break
        } catch (e) {
          if (
            attempt > 1 ||
            (e as { code?: string }).code !== 'TODO_CONFLICT'
          ) {
            throw e
          }
        }
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busy.value = false
    }
  }
  async function save(item: Item, revision: number) {
    if (busy.value || !ready.value) {
      return false
    }
    busy.value = true
    const args = {
      item,
      revision,
      seriesRevision: rows.value.find(
        (r) => !r.until && r.item.id === item.series,
      )?.revision,
    }
    const body = JSON.stringify(args)
    if (retry?.body !== body) {
      retry = { body, key: crypto.randomUUID() }
    }
    try {
      const result = await client.api.invoke<{
        revision: number
        created: string
      }>('save', args, { idempotencyKey: retry.key })
      rows.value = [
        ...rows.value.filter((r) => r.until || r.item.id !== item.id),
        { item: JSON.parse(JSON.stringify(item)), ...result },
      ]
      knownVersion = undefined
      retry = undefined
      error.value = ''
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      busy.value = false
    }
  }
  return { rows, ready, busy, error, load, save }
}
