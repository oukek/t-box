import type { BabyProfile } from '@t-box/baby-diary-contracts'
import type { CareNavigation } from './careNavigation'
import { dayjs } from '@t-box/dayjs'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { readCareNavigation, showCareNavigation } from './careNavigation'
import { errorText, host } from './runtime'

/** Personal, per-baby navigation preference; SDK keeps accounts/apps isolated. */
export function useCareNavigation(profile: () => BabyProfile | undefined) {
  const mode = ref<CareNavigation>('auto')
  const error = ref('')
  const now = ref(Date.now())
  let revision = 0
  let disposed = false
  let writes = Promise.resolve()
  const tick = setInterval(() => now.value = Date.now(), 60_000)
  watch(() => profile()?.id, async (id) => {
    const current = ++revision
    mode.value = 'auto'
    error.value = ''
    if (!id) {
      return
    }
    try {
      await writes
      const stored = await host().storage.get<unknown>(`care-navigation:${id}`)
      if (!disposed && current === revision && profile()?.id === id) {
        mode.value = readCareNavigation(stored)
      }
    } catch {
      // Reading an optional device preference must not block cloud records or timers.
    }
  }, { immediate: true })
  const visible = computed(() => {
    const baby = profile()
    return showCareNavigation(mode.value, baby?.birthDate ?? null, dayjs(now.value).tz(baby?.timezone || 'Asia/Shanghai').format('YYYY-MM-DD'))
  })
  function setMode(value: string) {
    const id = profile()?.id
    if (!id) {
      return
    }
    const chosen = readCareNavigation(value)
    const current = ++revision
    mode.value = chosen
    error.value = ''
    writes = writes.then(() => host().storage.set(`care-navigation:${id}`, chosen)).catch((cause) => {
      if (!disposed && current === revision && profile()?.id === id) {
        error.value = `当前选择已生效，但未能保存：${errorText(cause)}`
      }
    })
  }
  onBeforeUnmount(() => {
    disposed = true
    revision++
    clearInterval(tick)
  })
  return { mode, visible, error, setMode }
}
