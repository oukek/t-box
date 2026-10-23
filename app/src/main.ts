import { createApp } from 'vue'
import App from './App.vue'
import { initializeApplicationShell } from './applications/shellAdapter'
import { loadLocalApplications } from './core/app-runtime/localApplications'
import '@t-box/ui-kit/base.css'
import './style.css'
import './features/identity/identity.css'
import './features/chat/history.css'
import './features/chat/composer.css'
import './features/applications/applications.css'
import './features/resources/resources.css'

// Universal Link fallback when the native app is not installed.
const openPath = /^\/open\/([a-z][a-z0-9_-]{0,63})\/?$/.exec(location.pathname)
if (openPath) {
  history.replaceState(null, '', `/#/applications/${openPath[1]}${location.search}`)
}

void loadLocalApplications().finally(() => {
  initializeApplicationShell()
  createApp(App).mount('#app')
})
