import type { ApplicationContext } from '@t-box/app-contracts'
import type { AppClient } from '@t-box/app-sdk'
import { createApplicationRequestId } from '@t-box/app-contracts'
import { reactive } from 'vue'

export const identity = reactive<{ user: { id: string, username: string, nickname: string } | null }>({ user: null })
export const runtime = reactive({ params: {} as Record<string, string>, revision: 0, hostUrl: '' })
let client: AppClient | undefined
export const application = {
  get client() {
    if (!client) {
      throw new Error('记账应用尚未连接宿主')
    }
    return client
  },
}
export function configureRuntime(value: AppClient, context: ApplicationContext) {
  client = value
  runtime.params = { ...context.params }
  runtime.hostUrl = context.hostUrl || ''
  value.runtime.onNavigate((params) => {
    runtime.params = { ...params }
    runtime.revision++
  })
}
export const createRequestId = createApplicationRequestId
export const backFromApplication = () => application.client.navigation.back()
export const navigation = { backTo: 'applications' }
export const tabLabel = (_id: string) => 'OS'
export function openApplication(input: { appId: string, params?: Record<string, string> }) {
  if (input.appId !== 'ledger') {
    throw new Error('不支持跨应用导航')
  }
  return application.client.navigation.open(input.params || {})
}
