import { connectAppClient } from '@t-box/app-web-sdk'
import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

connectAppClient({})
  .then((connection) => {
    createApp(App, { client: connection.client }).mount('#app')
    connection.ready({ appNavigation: true })
    window.addEventListener('pagehide', () => connection.client.dispose(), {
      once: true,
    })
  })
  .catch((error) => {
    document.getElementById('app')!.textContent =
      error instanceof Error ? error.message : '应用连接失败'
  })
