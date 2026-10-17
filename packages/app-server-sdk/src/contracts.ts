import type {
  ApplicationClientInteraction,
  ApplicationContractVersion,
  ApplicationManifest,
  ApplicationToolDefinition,
  ApplicationToolEffect,
  AppUser,
  ChatMessage,
  Resource,
  ResourceRef,
  ToolExecution,
  ToolOutputPreview,
  ToolResult,
} from '@t-box/shared'

export interface Actor {
  user: AppUser
  sessionHash: string
}
export interface ClientInteraction {
  name: string
  arguments: unknown
  timeoutMs?: number
  /** Best-effort device synchronization only. Never use for consent or authorization. */
  optional?: boolean
}
export type Interact = (request: ClientInteraction) => Promise<ToolResult>
export interface ResourceRequirement {
  resource: ResourceRef
  action: string
}
export interface ResourceInspection {
  challenge?: ClientInteraction
}
/** Membership and role checks always precede a password challenge. */
export interface ResourceAdapter {
  appId: string
  inspect(
    actor: Actor,
    resource: ResourceRef,
    action: string,
    purpose: string,
  ): Promise<ResourceInspection>
  legacyReferences?(message: unknown): ResourceRef[]
}
export interface SkillDefinition {
  title: string
  description: string
  version: string
  tools: readonly string[]
  instructions: string
}
export interface SpecialistAgent {
  id: string
  title: string
  description: string
  version: string
  skillIds: readonly string[]
  instructions: string
}
/** Application adapters only see the context they need, not AI history or transport credentials. */
export interface ApplicationToolContext {
  readonly actor?: Actor
  readonly bindings: readonly ResourceRef[]
  readonly requestId: string
  readonly callId?: string
  readonly application?: {
    readonly appId: string
    readonly releaseId: string
    readonly generation: number
  }
  readonly signal: AbortSignal
  readonly interact: Interact
  readonly session: {
    readonly messages: readonly {
      readonly id: string
      readonly attachments?: readonly Resource[]
    }[]
    readonly task?: { readonly id: string } | null
  }
  use<T>(key: string, factory: () => Promise<T>): Promise<T>
}
export interface ApplicationToolRegistration<
  Context extends ApplicationToolContext = ApplicationToolContext,
> {
  definition: ApplicationToolDefinition
  title: string
  execution: ToolExecution
  effect: ApplicationToolEffect
  /** Published by the host once dispatch begins; never exposed as model input. */
  preview?: ToolOutputPreview
  /** Bypasses legacy skill activation; a deferred host still controls schema loading/budgets. */
  alwaysAvailable?: boolean
  /** Host bridge action for isolated web applications; the model still sees the application tool name. */
  clientAction?: string
  resources?(
    value: unknown,
    context: Context,
  ): ResourceRequirement[] | Promise<ResourceRequirement[]>
  confirm?(value: unknown, context: Context): Promise<ClientInteraction>
  validate?(value: unknown, context: Context): Promise<void>
  /** Rehydrate configuration state from a durable receipt; the host awaits completion. */
  restoreState?(result: ToolResult, context: Context): void | Promise<void>
  handler?(value: unknown, context: Context): Promise<unknown>
  normalizeClientArguments?(
    value: unknown,
    context: Context,
  ): unknown | Promise<unknown>
  sanitizeClientResult?(result: ToolResult): ToolResult
  writeFingerprint?(value: unknown): string
  attachments?(result: unknown): Resource[]
  successSummary: string
  /**
   * Opt-in for a single-operation task. Return a trusted final summary only
   * after validating the actual successful result; never use model prose.
   */
  completionSummary?(result: ToolResult): string | undefined
}
export interface NavigationAdapter<
  Context extends ApplicationToolContext = ApplicationToolContext,
> {
  properties: Record<string, Record<string, unknown>>
  parse(value: unknown): Record<string, string>
  contextualize?(
    params: Record<string, string>,
    context: Context,
  ): Record<string, string>
}
/** Restricted mutable view for migrations of legacy application references only. */
export interface ApplicationSessionState {
  scopeBindings?: ResourceRef[]
  messages: ChatMessage[]
  requests: Map<string, { scopeBindings?: ResourceRef[] }>
}
export interface ApplicationModule<
  Context extends ApplicationToolContext = ApplicationToolContext,
> {
  id: string
  contractVersion: ApplicationContractVersion
  manifest?: ApplicationManifest
  /** Returns a trusted release/installation revision; throws when not installed or authorized. */
  availability?(actor: Actor | undefined): Promise<string>
  skills: Record<string, SkillDefinition>
  tools: Record<string, ApplicationToolRegistration<Context>>
  agents?: readonly SpecialistAgent[]
  interactions?: readonly ApplicationClientInteraction[]
  access?: ResourceAdapter
  navigation?: NavigationAdapter<Context>
  instructions?(context: Context): Promise<string>
  decodeEvent?(event: Record<string, unknown>): Record<string, unknown>
  migrateSession?(session: ApplicationSessionState): void
}
