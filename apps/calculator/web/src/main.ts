import { connectAppClient } from '@t-box/app-web-sdk'
import { parseCalculatorParams } from '@t-box/calculator-contracts'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { createApp, h } from 'vue'
import CalculatorPage from './CalculatorPage.vue'
import { bindHistory, runtime } from './runtime'
import './base.css'

const node = document.getElementById('app')!
node.textContent = '正在连接计算器…'
connectAppClient({
  calculator_fill_expression(value) {
    const params = parseCalculatorParams(value)
    if (!params.expression) {
      throw new Error('请输入表达式')
    }
    runtime.kind = params.kind || 'scientific'
    runtime.expression = params.expression
    runtime.revision++
    return { filled: true }
  },
})
  .then(async (connection) => {
    runtime.subject = connection.context.subject
    bindHistory((records) =>
      connection.client.storage.set('calculator.history.v1', records),
    )
    try {
      runtime.initialHistory = await connection.client.storage.get(
        'calculator.history.v1',
      )
    } catch {
      /* Local backup remains usable. */
    }
    const params = parseCalculatorParams(connection.context.params)
    runtime.kind = params.kind || 'scientific'
    runtime.expression = params.expression || ''
    const ownsNavigation = connection.context.supportsAppNavigation === true
    node.textContent = ''
    createApp({
      render: () =>
        h('main', { class: 'application-frame' }, [
          ...(ownsNavigation ? [h(ApplicationHeader, { title: '计算器', backLabel: 'OS', onBack: () => connection.client.navigation.back() })] : []),
          h(CalculatorPage, {
            kind: runtime.kind,
            expression: runtime.expression || undefined,
            openRevision: runtime.revision,
          }),
        ]),
    }).mount(node)
    connection.ready({ appNavigation: ownsNavigation })
    window.addEventListener('pagehide', () => connection.client.dispose(), {
      once: true,
    })
  })
  .catch((e) => {
    node.textContent = e instanceof Error ? e.message : '计算器连接失败'
  })
