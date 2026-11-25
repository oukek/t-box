import { connectAppClient } from '@t-box/app-web-sdk'
import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

connectAppClient({})
  .then(({ client, ready }) => {
    createApp(App, { client }).mount('#app')
    ready({ appNavigation: true })
    window.addEventListener('pagehide', () => client.dispose(), { once: true })
  })
  .catch((e) => {
    document.querySelector('#app')!.textContent = e.message || '无法连接方舟'
  })
