import { createApp } from 'vue'
import { installCollectorBridge } from './features/identity/collectorBridge'
import { capturePromotionLink } from './features/promotions/attribution'
import '@t-box/ui-kit/base.css'
import './style.css'
import './features/identity/identity.css'
import './features/chat/history.css'
import './features/chat/composer.css'
import './features/applications/applications.css'
import './features/resources/resources.css'
import './workspace.css'

// Universal Link fallback when the native app is not installed.
capturePromotionLink()
const openPath = /^\/open\/([a-z][a-z0-9_-]{0,63})\/?$/.exec(location.pathname)
if (openPath) {
  history.replaceState(null, '', `/#/applications/${openPath[1]}${location.search}`)
}

if (location.hash.startsWith('#collector-login=')) {
  void import('./features/identity/CollectorLogin.vue').then(({ default: CollectorLogin }) => createApp(CollectorLogin).mount('#app'))
} else {
  installCollectorBridge()
  void Promise.all([import('./App.vue'), import('./applications/shellAdapter'), import('./core/app-runtime/localApplications')]).then(([{ default: App }, { initializeApplicationShell }, { loadLocalApplications }]) => {
    void loadLocalApplications().finally(() => {
      initializeApplicationShell()
      createApp(App).mount('#app')
    })
  })
}
