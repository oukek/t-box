import { ref } from 'vue'

export const systemVersionOpen = ref(false)

export function openSystemVersion() {
  systemVersionOpen.value = true
}
