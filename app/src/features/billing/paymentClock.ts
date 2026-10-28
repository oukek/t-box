import { onBeforeUnmount, ref } from 'vue'

export function usePaymentClock() {
  const now = ref(Date.now())
  const timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  onBeforeUnmount(() => clearInterval(timer))
  return now
}
export function paymentCountdown(deadline: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
