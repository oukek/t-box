import type { ApplicationContext } from '@t-box/app-contracts'
import type { AppClient } from '@t-box/app-sdk'
import { reactive } from 'vue'

export const identity = reactive<{ user: { id: string } | null }>({ user: null })
export const runtime = reactive({ params: {} as Record<string, string>, revision: 0 })
let client: AppClient | undefined
export const application = { get client() {
  if (!client) {
    throw new Error('应用尚未连接宿主')
  }
  return client
} }
export function configureRuntime(value: AppClient, context: ApplicationContext) {
  client = value
  identity.user = { id: context.subject }
  runtime.params = { ...context.params }
  value.runtime.onNavigate((params) => {
    runtime.params = { ...params }
    runtime.revision++
  })
  value.runtime.onClose(() => {
    identity.user = null
  })
}

export const preferences = reactive<{ clocks: unknown, stopwatch: unknown }>({ clocks: null, stopwatch: null })
export async function loadPreferences() {
  const [clocks, stopwatch] = await Promise.allSettled([application.client.storage.get('time.clocks.v1'), application.client.storage.get('time.stopwatch.v1')])
  preferences.clocks = clocks.status === 'fulfilled' ? clocks.value : null
  preferences.stopwatch = stopwatch.status === 'fulfilled' ? stopwatch.value : null
}
