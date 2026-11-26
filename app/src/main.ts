import { createApp } from 'vue'
import { listenForInstall } from './core/web-release/installPrompt'
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
if (openPath || location.pathname === '/open.html') {
  const id = openPath?.[1] ?? new URLSearchParams(location.search).get('app') ?? ''
  const appId = /^[a-z][a-z0-9_-]{0,63}$/.test(id) ? id : ''
  void import('./core/native-runtime/ApplicationLink.vue').then(({ default: ApplicationLink }) => {
    createApp(ApplicationLink, { appId }).mount('#app')
  })
} else if (location.hash.startsWith('#collector-login=')) {
  void import('./features/identity/CollectorLogin.vue').then(({ default: CollectorLogin }) => createApp(CollectorLogin).mount('#app'))
} else {
  if (import.meta.env.PROD && !window.__TBOX_DESKTOP_KEY__ && !window.Capacitor?.isNativePlatform?.()) {
    listenForInstall()
  }
  installCollectorBridge()
  void Promise.all([import('./App.vue'), import('./applications/shellAdapter'), import('./core/app-runtime/localApplications'), window.__TBOX_DESKTOP_KEY__ && import('./core/web-release/desktopTransfer').then(({ readStartupTransfer }) => readStartupTransfer())]).then(([{ default: App }, { initializeApplicationShell }, { loadLocalApplications }]) => {
    void loadLocalApplications().finally(() => {
      initializeApplicationShell()
      createApp(App).mount('#app')
    })
  })
}
