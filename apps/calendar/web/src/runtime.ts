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
