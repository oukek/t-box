import { readonly, ref } from 'vue'

const state = ref(navigator.onLine)
window.addEventListener('online', () => {
  state.value = true
})
window.addEventListener('offline', () => {
  state.value = false
})
export const online = readonly(state)
