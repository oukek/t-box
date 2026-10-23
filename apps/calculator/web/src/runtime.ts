import type { AppClient } from '@t-box/app-sdk'
import type { CalculationInput } from '@t-box/calculator-contracts'
import { SdkErrorCode } from '@t-box/app-sdk'
import { reactive } from 'vue'

export const runtime = reactive({
  subject: '',
  kind: 'scientific',
  expression: '',
  initialHistory: null as unknown,
  historyRevision: 0,
  revision: 0,
})

// eslint-disable-next-line import/no-mutable-exports -- Shell adapters replace this live binding when history persistence becomes available.
export let persistHistory: ((records: unknown) => Promise<unknown>) | undefined
export function bindHistory(writer: (records: unknown) => Promise<unknown>) {
  persistHistory = writer
}

export const shortcutState = reactive({ available: false })
let automationClient: AppClient | undefined
export function bindAutomation(client: AppClient) {
  automationClient = client
  void Promise.all([client.runtime.supports('automation.saveShortcut'), client.auth.getSession()]).then(([supported, session]) => {
    shortcutState.available = supported && session.status === 'signed_in'
  }).catch(() => {})
}
export async function saveCalculationShortcut(input: CalculationInput, title: string) {
  if (!automationClient) {
    throw SdkErrorCode.APP_CLOSED()
  }
  return automationClient.automation.saveShortcut({ title: title.slice(0, 100), actionId: 'calculate', actionVersion: 1, arguments: { kind: input.kind, values: input.values } })
}
