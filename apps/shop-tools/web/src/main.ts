import { connectAppClient } from '@t-box/app-web-sdk'
import { createApp } from 'vue'
import App from './Projects.vue'
import './style.css'

connectAppClient({})
  .then((connection) => {
    const page = createApp(App, { client: connection.client }).mount('#app') as InstanceType<typeof App>
    connection.ready({ appNavigation: true, beforeSystemUpdate: () => page.beforeSystemUpdate() })
    window.addEventListener('pagehide', () => connection.client.dispose(), {
      once: true,
    })
  })
  .catch((error) => {
    document.getElementById('app')!.textContent =
      error instanceof Error ? error.message : '应用连接失败'
  })
