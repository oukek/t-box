import {
  uniqueResources,
  type ChatMessage,
  type ResourceRef,
} from "@t-box/shared";
import { ApiError } from "@t-box/server-foundation/errors";
import type { Actor, Interact, ResourceAdapter } from "./contracts.js";
import { object, parseIdentifier } from "./schema.js";
/** Resource identity is safe metadata only after the adapter has verified membership. */
export class ResourceAuthorizationRequired extends ApiError {
  constructor(readonly resource: ResourceRef) {
    super(423, "RESOURCE_LOCKED", "请先授权此会话涉及的资源");
  }
}
export class ResourceAccessRegistry {
  private readonly adapters = new Map<string, ResourceAdapter>();
  constructor(adapters: ResourceAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.appId))
        throw new Error(`Duplicate resource adapter: ${adapter.appId}`);
      this.adapters.set(adapter.appId, adapter);
    }
  }
  parse(value: unknown): ResourceRef[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 16)
      throw new ApiError(
        400,
        "INVALID_SCOPE",
        "资源作用域应为最多 16 个资源的数组",
      );
    const refs = value.map((raw) => {
      const row = object(raw, ["appId", "resourceType", "resourceId"]);
      const ref = {
        appId: parseIdentifier(row.appId),
        resourceType: parseIdentifier(row.resourceType),
        resourceId: parseIdentifier(row.resourceId),
      };
      if (!this.adapters.has(ref.appId))
        throw new ApiError(400, "INVALID_SCOPE", "资源应用未注册");
      return ref;
    });
    if (uniqueResources(refs).length !== refs.length)
      throw new ApiError(400, "INVALID_SCOPE", "资源作用域不可重复");
    return refs;
  }
  references(messages: readonly ChatMessage[]): ResourceRef[] {
    return uniqueResources(
      messages.flatMap((message) => [
        ...(message.resourceRefs || []),
        ...[...this.adapters.values()].flatMap(
          (adapter) => adapter.legacyReferences?.(message) || [],
        ),
      ]),
    );
  }
  async inspect(
    actor: Actor,
    ref: ResourceRef,
    action = "read",
    purpose = "访问资源",
  ) {
    const adapter = this.adapters.get(ref.appId);
    if (!adapter)
      throw new ApiError(403, "RESOURCE_UNAVAILABLE", "资源应用未注册或已停用");
    return adapter.inspect(actor, ref, action, purpose);
  }
  async ensure(
    actor: Actor,
    ref: ResourceRef,
    action = "read",
    interact?: Interact,
    purpose = "访问资源",
  ) {
    const { challenge } = await this.inspect(actor, ref, action, purpose);
    if (!challenge) return;
    if (!interact) throw new ResourceAuthorizationRequired(ref);
    const result = await interact(challenge);
    if (
      !result.ok ||
      (result.data as { authorized?: boolean })?.authorized !== true
    )
      throw new ApiError(
        403,
        "AUTHORIZATION_CANCELLED",
        "未授权，操作不会继续",
      );
    // The UI ACK never authorizes the resource. Recheck the trusted adapter.
    if ((await this.inspect(actor, ref, action, purpose)).challenge)
      throw new ApiError(423, "RESOURCE_LOCKED", "资源授权尚未生效");
  }
  async history(
    actor: Actor,
    messages: readonly ChatMessage[],
    interact?: Interact,
  ) {
    for (const ref of this.references(messages))
      await this.ensure(actor, ref, "read", interact, "继续包含此资源的会话");
  }
  mark(messages: ChatMessage[], refs: ResourceRef[]) {
    for (const role of ["user", "assistant"] as const) {
      const message = messages.findLast((m) => m.role === role);
      if (message)
        message.resourceRefs = uniqueResources([
          ...(message.resourceRefs || []),
          ...refs,
        ]);
    }
  }
}
