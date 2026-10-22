import { connectAppClient } from '@t-box/app-web-sdk'
import { createApp } from 'vue'
import App from './App.vue'
import { configureRuntime } from './runtime'
import './style.css'

connectAppClient()
  .then(async (connection) => {
    const session = await connection.client.auth.ensureSignedIn()
    configureRuntime(
      connection.client,
      connection.context,
      session.profile?.nickname || '家人',
    )
    createApp(App).mount('#app')
    connection.ready({ appNavigation: true })
    window.addEventListener('pagehide', () => connection.client.dispose(), {
      once: true,
    })
  })
  .catch((error) => {
    document.getElementById('app')!.textContent =
      error instanceof Error ? error.message : '应用连接失败'
  })
