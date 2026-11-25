import { ref, shallowRef } from 'vue'

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}

export const installPrompt = shallowRef<InstallPrompt>()
export const installed = ref(false)

export function listenForInstall() {
  installed.value = matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt.value = event as InstallPrompt
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    installPrompt.value = undefined
  })
}
