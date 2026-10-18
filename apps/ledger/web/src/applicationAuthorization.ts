import { reactive, readonly } from 'vue'
import { ErrorCode } from './error-codes.js'

const state = reactive({
  open: false,
  ledgerId: '',
  ledgerName: '',
  scope: 'read' as 'read' | 'write',
  purpose: '',
})
let settle: ((value: { authorized: boolean }) => void) | undefined
export const applicationAuthorization = readonly(state)
export function requestApplicationAuthorization(
  value: unknown,
): Promise<{ authorized: boolean }> {
  if (settle || !value || typeof value !== 'object') {
    throw ErrorCode.INTERNAL_AUTHORIZATION_UNAVAILABLE()
  }
  const args = value as typeof state
  if (
    typeof args.ledgerId !== 'string' ||
    !/^[\da-f-]{36}$/i.test(args.ledgerId) ||
    typeof args.ledgerName !== 'string' ||
    typeof args.purpose !== 'string' ||
    !['read', 'write'].includes(args.scope)
  ) {
    throw ErrorCode.INTERNAL_INVALID_AUTHORIZATION_SCOPE()
  }
  Object.assign(state, {
    open: true,
    ledgerId: args.ledgerId,
    ledgerName: args.ledgerName,
    scope: args.scope,
    purpose: args.purpose,
  })
  return new Promise((resolve) => {
    settle = resolve
  })
}
export function resolveApplicationAuthorization(authorized: boolean) {
  const finish = settle
  settle = undefined
  state.open = false
  finish?.({ authorized })
}
