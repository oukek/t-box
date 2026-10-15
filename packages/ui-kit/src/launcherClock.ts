import { onScopeDispose, readonly, shallowRef, watch } from 'vue'

const now = shallowRef(new Date())
let subscribers = 0
let timer: ReturnType<typeof setInterval> | undefined
function refresh() {
  now.value = new Date()
}
function stopTimer() {
  clearInterval(timer)
  timer = undefined
}
function visibilityChanged() {
  stopTimer()
  if (subscribers && !document.hidden) {
    refresh()
    timer = setInterval(refresh, 1000)
  }
}
function subscribe() {
  if (++subscribers === 1) {
    document.addEventListener('visibilitychange', visibilityChanged)
    visibilityChanged()
  }
  return () => {
    if (--subscribers === 0) {
      stopTimer()
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }
}
/** All visible live icons share one wall-clock ticker; hidden pages release their timer. */
export function useLauncherClock(enabled: () => boolean) {
  let unsubscribe: (() => void) | undefined
  watch(enabled, (active) => {
    unsubscribe?.()
    unsubscribe = active ? subscribe() : undefined
  }, { immediate: true })
  onScopeDispose(() => unsubscribe?.())
  return readonly(now)
}
export function clockHandAngles(date: Date) {
  const second = date.getSeconds()
  const minute = date.getMinutes() + second / 60
  return { second: second * 6, minute: minute * 6, hour: ((date.getHours() % 12) + minute / 60) * 30 }
}
