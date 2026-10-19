import type { ApplicationContext } from '@t-box/app-contracts'
import type { AppClient } from '@t-box/app-sdk'
import { reactive } from 'vue'
import { ErrorCode } from './error-codes.js'

export const identity = reactive<{ user: { id: string } | null, signedIn: boolean }>({
  user: null,
  signedIn: false,
})
export const runtime = reactive({
  params: {} as Record<string, string>,
  revision: 0,
})
export const preferences = reactive<{ clocks: unknown, stopwatch: unknown, loaded: boolean }>({
  clocks: null,
  stopwatch: null,
  loaded: false,
})

let client: AppClient | undefined
export const application = {
  get client() {
    if (!client) {
      throw ErrorCode.INTERNAL_HOST_NOT_CONNECTED()
    }
    return client
  },
}
export function configureRuntime(
  value: AppClient,
  context: ApplicationContext,
  signedIn = true,
) {
  client = value
  identity.signedIn = signedIn
  if (identity.user?.id !== context.subject) {
    preferences.clocks = null
    preferences.stopwatch = null
    preferences.loaded = false
  }
  identity.user = { id: context.subject }
  runtime.params = { ...context.params }
  value.runtime.onNavigate((params) => {
    if (client !== value) {
      return
    }
    runtime.params = { ...params }
    runtime.revision++
  })
  value.runtime.onClose(() => {
    if (client === value) {
      identity.user = null
    }
  })
}

export async function loadPreferences() {
  const owner = identity.user?.id
  const previousClocks = preferences.clocks
  const previousStopwatch = preferences.stopwatch
  const [clocks, stopwatch] = await Promise.allSettled([
    application.client.storage.get('time.clocks.v1'),
    application.client.storage.get('time.stopwatch.v1'),
  ])
  if (!owner || identity.user?.id !== owner) {
    return
  }
  if (preferences.clocks === previousClocks) {
    preferences.clocks = clocks.status === 'fulfilled' ? clocks.value : null
  }
  if (preferences.stopwatch === previousStopwatch) {
    preferences.stopwatch = stopwatch.status === 'fulfilled' ? stopwatch.value : null
  }
  preferences.loaded = true
}
