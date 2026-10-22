import type { CareInput, CarePage, CareRecord } from '@t-box/baby-diary-contracts/care'
import type { CareCommand, CareSnapshot } from '@t-box/baby-diary-core'
import { BabyErrorCode } from '@t-box/baby-diary-contracts'
import { parseCare } from '@t-box/baby-diary-contracts/care'
import { CareOutbox, carePreview, emptyCareSnapshot } from '@t-box/baby-diary-core'
import { dayjs } from '@t-box/dayjs'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { baby, errorText, host, invoke, onPrivateClear, runtime, today } from './runtime'

export function useCare(revision: () => number, range: () => { from: string, to: string }) {
  const babyId = baby.value!.id
  const subject = runtime.subject
  const profile = baby.value!
  const key = `care-v1-${babyId}`
  const snapshot = shallowRef<CareSnapshot>(emptyCareSnapshot())
  const fullPage = shallowRef<CarePage>()
  const error = ref('')
  const loading = ref(false)
  const syncing = ref(false)
  const ready = ref(false)
  const online = ref(navigator.onLine)
  const now = ref(Date.now())
  let store: CareOutbox | undefined
  let closed = false
  let loadVersion = 0
  let syncingPromise: Promise<void> | undefined
  let resync = false
  const records = computed(() => {
    const cache = [...new Map([...(fullPage.value?.records ?? []), ...snapshot.value.records].map((row) => [row.id, row])).values()]
    return carePreview({ ...snapshot.value, records: cache }, babyId, subject, runtime.nickname).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  })
  const active = computed(() => records.value.filter((row) => !row.deletedAt && row.state !== 'completed'))
  const pendingIds = computed(() => new Set(snapshot.value.pending.map((command) => command.target)))
  const cached = computed(() => snapshot.value.from <= range().from && snapshot.value.to >= range().to && !!snapshot.value.asOf)
  async function load() {
    if (!navigator.onLine || closed || !runtime.active) {
      return
    }
    const version = ++loadVersion
    const { from, to } = range()
    loading.value = true
    try {
      const result = await invoke<CarePage>('care_list', { babyId, from, to })
      if (!closed && version === loadVersion) {
        fullPage.value = result
        await store?.accept(result, from, to)
        error.value = ''
      }
    } catch (cause) {
      if (!closed && version === loadVersion) {
        error.value = errorText(cause)
      }
    } finally {
      if (!closed && version === loadVersion) {
        loading.value = false
      }
    }
  }
  function sync() {
    if (syncingPromise) {
      resync = true
      return syncingPromise
    }
    if (!navigator.onLine || closed || !runtime.active || !store) {
      return syncingPromise ?? Promise.resolve()
    }
    syncing.value = true
    // A refresh follows the drain, so confirmed writes replace temporary local IDs before painting remote data.
    let failure = ''
    syncingPromise = store.flush().catch((cause) => {
      failure = errorText(cause)
    }).then(load).then(() => {
      if (failure && !closed) {
        error.value = failure
      }
    }).catch((cause) => {
      if (!closed) {
        error.value = errorText(cause)
      }
    }).finally(() => {
      syncing.value = false
      syncingPromise = undefined
      if (resync && !closed) {
        resync = false
        void sync()
      }
    })
    return syncingPromise
  }
  async function submit(input: CareInput, current?: CareRecord) {
    if (!store || !runtime.active || !ready.value) {
      throw BabyErrorCode.BABY_INVALID_INPUT('本机存储尚未准备好，请稍后重试')
    }
    const record = parseCare(input)
    const key = crypto.randomUUID()
    await store.enqueue({ key, action: current ? 'update' : 'add', target: current?.id ?? key, revision: current?.revision ?? 0, record, at: new Date().toISOString() })
    void sync()
  }
  async function remove(row: CareRecord, restore = false) {
    if (!store) {
      return
    }
    await store.enqueue({ key: crypto.randomUUID(), action: restore ? 'restore' : 'delete', target: row.id, revision: row.revision, at: new Date().toISOString() })
    void sync()
  }
  async function discard(command: CareCommand) {
    await store?.discard(command.key)
    await sync()
  }
  async function retry() {
    await store?.retry()
    await sync()
  }
  const tick = setInterval(() => {
    if (document.visibilityState === 'visible') {
      now.value = Date.now()
    }
  }, 1000)
  const foreground = () => {
    online.value = navigator.onLine
    now.value = Date.now()
    if (document.visibilityState === 'visible') {
      void sync()
    }
  }
  const offline = () => {
    online.value = false
  }
  onMounted(async () => {
    try {
      const raw = await host().storage.get<CareSnapshot>(key)
      const initial = raw?.version === 1 && Array.isArray(raw.records) && Array.isArray(raw.pending) ? raw : emptyCareSnapshot()
      if (closed) {
        return
      }
      store = new CareOutbox({ babyId, subject, name: runtime.nickname, save: (state) => host().storage.set(key, state), invoke: (method, args, key) => invoke(method, args, key), changed: (state) => {
        snapshot.value = state
      } }, initial)
      ready.value = true
      await sync()
    } catch (cause) {
      error.value = errorText(cause)
    }
  })
  watch([revision, () => range().from, () => range().to], () => {
    void sync()
  })
  const stop = onPrivateClear(() => {
    closed = true
    loadVersion++
    store?.close()
    snapshot.value = emptyCareSnapshot()
    fullPage.value = undefined
  })
  document.addEventListener('visibilitychange', foreground)
  window.addEventListener('online', foreground)
  window.addEventListener('offline', offline)
  onBeforeUnmount(() => {
    closed = true
    loadVersion++
    store?.close()
    stop()
    clearInterval(tick)
    document.removeEventListener('visibilitychange', foreground)
    window.removeEventListener('online', foreground)
    window.removeEventListener('offline', offline)
  })
  return { profile, snapshot, records, active, pendingIds, cached, fullPage, error, loading, syncing, ready, online, now, submit, remove, discard, retry, load, today: () => dayjs(now.value).tz(profile.timezone).format('YYYY-MM-DD'), selectedToday: today }
}
