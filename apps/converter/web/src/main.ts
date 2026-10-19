import { connectAppClient } from '@t-box/app-web-sdk'
import { parseConverterParams } from '@t-box/converter-contracts'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { createApp, h, reactive } from 'vue'
import ConverterPage from './ConverterPage.vue'
import './style.css'

const root = document.getElementById('app')!
connectAppClient({}).then((connection) => {
  const state = reactive({ params: parseConverterParams(connection.context.params), revision: 0 })
  connection.client.runtime.onNavigate((value) => {
    state.params = parseConverterParams(value)
    state.revision++
  })
  root.textContent = ''
  createApp({ render: () => h('main', { class: 'application-frame' }, [
    h(ApplicationHeader, { title: '单位换算', backLabel: 'OS', onBack: () => connection.client.navigation.back() }),
    h(ConverterPage, { client: connection.client, params: state.params, revision: state.revision }),
  ]) }).mount(root)
  connection.ready({ appNavigation: true })
  window.addEventListener('pagehide', () => connection.client.dispose(), { once: true })
}).catch((error) => {
  root.textContent = error instanceof Error ? error.message : '应用连接失败'
})
