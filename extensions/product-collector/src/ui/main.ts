import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')

if (new URLSearchParams(location.search).has('embedded')) {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('[role="dialog"], dialog[open]')) {
      window.parent.postMessage({ action: 'tark-close-panel' }, '*')
    }
  })
}
