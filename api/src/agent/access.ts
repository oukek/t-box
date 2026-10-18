import type { ChatMessage, ResourceRef } from '@t-box/shared'
import type { Actor, Interact, ResourceAdapter } from './contracts.js'
import { ApiError } from '@t-box/server-foundation/errors'
import { uniqueResources } from '@t-box/shared'
import { ErrorCode } from '../error-codes.js'
import { object, parseIdentifier } from './schema.js'
/** Resource identity is safe metadata only after the adapter has verified membership. */
export class ResourceAuthorizationRequired extends ApiError {
  constructor(readonly resource: ResourceRef) {
    super(423, 'RESOURCE_LOCKED', '请先授权此会话涉及的资源')
  }
}
export class ResourceAccessRegistry {
  private readonly adapters = new Map<string, ResourceAdapter>()
  constructor(adapters: ResourceAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.appId)) {
        throw ErrorCode.INTERNAL_DUPLICATE_RESOURCE_ADAPTER(
          `Duplicate resource adapter: ${adapter.appId}`,
        )
      }
      this.adapters.set(adapter.appId, adapter)
    }
  }

  parse(value: unknown): ResourceRef[] {
    if (value === undefined) {
      return []
    }
    if (!Array.isArray(value) || value.length > 16) {
      throw ErrorCode.INVALID_SCOPE()
    }
    const refs = value.map((raw) => {
      const row = object(raw, ['appId', 'resourceType', 'resourceId'])
      const ref = {
        appId: parseIdentifier(row.appId),
        resourceType: parseIdentifier(row.resourceType),
        resourceId: parseIdentifier(row.resourceId),
      }
      if (!this.adapters.has(ref.appId)) {
        throw ErrorCode.INVALID_SCOPE('资源应用未注册')
      }
      return ref
    })
    if (uniqueResources(refs).length !== refs.length) {
      throw ErrorCode.INVALID_SCOPE('资源作用域不可重复')
    }
    return refs
  }

  references(messages: readonly ChatMessage[]): ResourceRef[] {
    return uniqueResources(
      messages.flatMap((message) => [
        ...(message.resourceRefs || []),
        ...[...this.adapters.values()].flatMap(
          (adapter) => adapter.legacyReferences?.(message) || [],
        ),
      ]),
    )
  }

  async inspect(
    actor: Actor,
    ref: ResourceRef,
    action = 'read',
    purpose = '访问资源',
  ) {
    const adapter = this.adapters.get(ref.appId)
    if (!adapter) {
      throw ErrorCode.RESOURCE_UNAVAILABLE.forbidden()
    }
    return adapter.inspect(actor, ref, action, purpose)
  }

  async ensure(
    actor: Actor,
    ref: ResourceRef,
    action = 'read',
    interact?: Interact,
    purpose = '访问资源',
  ) {
    const { challenge } = await this.inspect(actor, ref, action, purpose)
    if (!challenge) {
      return
    }
    if (!interact) {
      throw new ResourceAuthorizationRequired(ref)
    }
    const result = await interact(challenge)
    if (
      !result.ok ||
      (result.data as { authorized?: boolean })?.authorized !== true
    ) {
      throw ErrorCode.AUTHORIZATION_CANCELLED()
    }
    // The UI ACK never authorizes the resource. Recheck the trusted adapter.
    if ((await this.inspect(actor, ref, action, purpose)).challenge) {
      throw ErrorCode.RESOURCE_LOCKED()
    }
  }

  async history(
    actor: Actor,
    messages: readonly ChatMessage[],
    interact?: Interact,
  ) {
    for (const ref of this.references(messages)) {
      await this.ensure(actor, ref, 'read', interact, '继续包含此资源的会话')
    }
  }

  mark(messages: ChatMessage[], refs: ResourceRef[]) {
    for (const role of ['user', 'assistant'] as const) {
      const message = messages.findLast((m) => m.role === role)
      if (message) {
        message.resourceRefs = uniqueResources([
          ...(message.resourceRefs || []),
          ...refs,
        ])
      }
    }
  }
}
