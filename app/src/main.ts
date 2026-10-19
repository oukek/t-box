import { createApp } from 'vue'
import App from './App.vue'
import { initializeApplicationShell } from './applications/shellAdapter'
import { loadLocalApplications } from './core/app-runtime/localApplications'
import '@t-box/ui-kit/base.css'
import './style.css'
import './features/chat/history.css'
import './features/chat/composer.css'
import './features/applications/applications.css'
import './features/resources/resources.css'

void loadLocalApplications().finally(() => {
  initializeApplicationShell()
  createApp(App).mount('#app')
})
