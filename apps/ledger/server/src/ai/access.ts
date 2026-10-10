import type { ResourceRef } from '@t-box/app-contracts'
import type { ApplicationSessionState, ResourceAdapter } from '@t-box/app-server-sdk'
import type { LedgerAccess } from '../ledgers/access.js'
import { ApiError } from '@t-box/server-foundation/errors'
import { parseId } from '../validation.js'

const reference = (id: string): ResourceRef => ({
  appId: 'ledger',
  resourceType: 'book',
  resourceId: id,
})
export function ledgerAccessAdapter(access: LedgerAccess): ResourceAdapter {
  return {
    appId: 'ledger',
    legacyReferences(message) {
      const id = (message as { ledgerId?: unknown })?.ledgerId
      return typeof id === 'string' ? [reference(parseId(id))] : []
    },
    async inspect(actor, ref, action, purpose) {
      if (
        ref.resourceType !== 'book' ||
        !['read', 'write', 'manage', 'own'].includes(action)
      ) {
        throw new ApiError(400, 'INVALID_SCOPE', '不支持的账本资源或操作范围')
      }
      const { book, locked } = await access.check(
        actor,
        parseId(ref.resourceId),
        action as 'read' | 'write' | 'manage' | 'own',
        true,
      )
      return locked
        ? {
            challenge: {
              name: 'application_authorize',
              arguments: {
                ledgerId: book.id,
                ledgerName: book.name,
                scope: action === 'read' ? 'read' : 'write',
                purpose,
              },
            },
          }
        : {}
    },
  }
}
export function decodeLedgerEvent(event: Record<string, unknown>) {
  if (event.type !== 'message.send' || event.ledgerId === undefined) {
    return event
  }
  const { ledgerId, ...rest } = event
  const ref = reference(parseId(ledgerId))
  if (rest.scopeBindings !== undefined && !Array.isArray(rest.scopeBindings)) {
    throw new ApiError(400, 'INVALID_SCOPE', '资源作用域必须为数组')
  }
  const refs = (rest.scopeBindings || []) as ResourceRef[]
  if (
    refs.some(
      (value) =>
        value.appId === 'ledger' && value.resourceId !== ref.resourceId,
    )
  ) {
    throw new ApiError(400, 'INVALID_SCOPE', '旧账本字段与资源作用域冲突')
  }
  return {
    ...rest,
    scopeBindings: [...refs.filter((value) => value.appId !== 'ledger'), ref],
  }
}
export function migrateLedgerSession(session: ApplicationSessionState) {
  const legacy = session as ApplicationSessionState & { ledgerId?: string }
  if (legacy.ledgerId && !session.scopeBindings?.length) {
    session.scopeBindings = [reference(legacy.ledgerId)]
  }
  delete legacy.ledgerId
  for (const message of session.messages) {
    const old = message as typeof message & { ledgerId?: string }
    if (old.ledgerId) {
      message.resourceRefs = [
        ...(message.resourceRefs || []),
        reference(old.ledgerId),
      ]
      delete old.ledgerId
    }
  }
  for (const request of session.requests.values()) {
    const old = request as typeof request & { ledgerId?: string }
    if (old.ledgerId && !request.scopeBindings?.length) {
      request.scopeBindings = [reference(old.ledgerId)]
    }
    delete old.ledgerId
  }
}
