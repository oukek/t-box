import type {
  Resource,
  ResourceRef,
  TaskStatus,
  TaskSummary,
  TaskToolRecord,
  ToolResult,
} from '@t-box/shared'
import type {
  Actor,
  ApplicationToolContext,
  ApplicationToolRegistration,
  Interact,
  ApplicationModule as SdkApplicationModule,
  NavigationAdapter as SdkNavigationAdapter,
} from '../application-sdk/contracts.js'
import type { ChatProvider, ProviderItem } from '../chat/provider.js'
import type { ChatSession, SessionRepository } from '../chat/session.js'
import type { CapabilityRegistry } from './registry.js'

export type {
  Actor,
  ClientInteraction,
  Interact,
  ResourceAdapter,
  ResourceInspection,
  ResourceRequirement,
  SkillDefinition,
  SpecialistAgent,
} from '../application-sdk/contracts.js'

export interface ToolContext extends ApplicationToolContext {
  memory?: import('../memory/contracts.js').MemoryPort
  memoryIds?: Set<string>
  capabilities?: import('./capability-loading.js').CapabilitySelection
  toolSchemaBudget?: number
  /** Fresh for one orchestration iteration, never cached across execution/grant checks. */
  capabilityAvailability?: { promise?: Promise<Set<string>> }
  configurationSnapshot?: import('@t-box/shared').ConfigurationSnapshot
  answerRetry?: boolean
  registry: CapabilityRegistry
  modulePins?: Record<string, { revision: string, installation: string }>
  skills: Set<string>
  agentId?: string
  toolAllowlist?: ReadonlySet<string>
  skillAllowlist?: ReadonlySet<string>
  applicationAllowlist?: ReadonlySet<string>
  journal?: ToolJournal
  bindings: readonly ResourceRef[]
  actor?: Actor
  session: ChatSession
  requestId: string
  signal: AbortSignal
  interact: Interact
  /** Run-local memoization; configuration/service snapshots do not leak across runs. */
  use<T>(key: string, factory: () => Promise<T>): Promise<T>
}
export interface ToolJournal {
  lookup(call: {
    id: string
    name: string
    arguments: string
    writeKey?: string
  }): Promise<ToolResult | undefined>
  dispatch(
    call: { id: string, name: string, arguments: string, writeKey?: string },
    effect: ToolRegistration['effect'],
    agentId: string,
  ): Promise<void>
  complete(callId: string, result: ToolResult): Promise<void>
  guard(): Promise<void>
}
/** Durable execution storage is a host port; the runtime has no database dependency. */
export interface TaskPort {
  create(
    actor: Actor,
    id: string,
    conversationId: string,
    requestId: string,
    checkpoint: unknown,
    agentId: string,
    existingConversation?: boolean,
    archiveRevision?: number,
  ): Promise<void>
  claim(actor: Actor, id: string, owner: string, recoveryClaim?: string): Promise<void>
  guard(id: string, owner: string): Promise<void>
  checkpoint(
    id: string,
    owner: string,
    value: unknown,
    agentId: string,
  ): Promise<void>
  finish(
    id: string,
    owner: string,
    status: TaskStatus,
    reason?: string,
    execution?: import('@t-box/shared').MessageExecution,
    recoverAfterShutdown?: boolean,
    result?: import('@t-box/shared').ChatMessage,
  ): Promise<void>
  get(
    actor: Actor,
    id: string,
  ): Promise<{
    summary: TaskSummary
    checkpoint: unknown
    tools: TaskToolRecord[]
  }>
  current(actor: Actor, conversationId: string): Promise<TaskSummary | null>
  cancel(actor: Actor, id: string): Promise<void>
  /** Atomic retirement; must never cancel a concurrently resumed/running task. */
  cancelSuspended?(actor: Actor, id: string): Promise<void>
  journal(id: string, owner: string): ToolJournal
}
export type ToolRegistration = ApplicationToolRegistration<ToolContext>
export type NavigationAdapter = SdkNavigationAdapter<ToolContext>
/** Optional version is retained for internal legacy/test modules; new SDK modules require it. */
export type ApplicationModule = Omit<
  SdkApplicationModule<ToolContext>,
  'contractVersion'
> & {
  contractVersion?: SdkApplicationModule<ToolContext>['contractVersion']
}
export interface ConversationPort {
  subscribe?(userId: string, conversationId: string, listener: () => void): () => void
  getTitle?(actor: Actor, id: string): Promise<string>
  needsTitle?(actor: Actor, id: string): Promise<boolean>
  setGeneratedTitle?(actor: Actor, id: string, title: string): Promise<string>
  save(
    session: ChatSession,
    lease?: { taskId: string, owner: string },
  ): Promise<void>
  load(actor: Actor, id: string): Promise<unknown>
  restore(
    actor: Actor,
    id: string,
    session: ChatSession,
    trustedRefresh?: boolean,
    running?: boolean,
  ): Promise<void>
  exists(actor: Actor, id: string): Promise<boolean>
}
export interface AttachmentPort {
  restoreContextReferences?(
    original: ProviderItem[],
    prepared: ProviderItem[],
    compacted: ProviderItem[],
  ): ProviderItem[]
  attachments(actor: Actor, ids: unknown): Promise<Resource[]>
  modelHistory(actor: Actor, history: ProviderItem[]): Promise<ProviderItem[]>
  append(history: ProviderItem[], text: string, attachments: Resource[]): void
}
export interface AgentHost {
  memory?: import('../memory/contracts.js').MemoryPort
  identity: {
    authenticate(token: string): Promise<Actor>
    authenticateHash(hash: string): Promise<Actor>
  }
  conversations?: ConversationPort
  attachments?: AttachmentPort
  tasks?: TaskPort
}

export interface AgentRuntimeOptions {
  /** Composition roots opt in; old embedded hosts/checkpoints keep their protocol. */
  capabilityLoading?: 'deferred' | 'legacy'
  configuration?: {
    snapshot(): Promise<import('@t-box/shared').ConfigurationSnapshot>
  }
  onRunError?: (error: {
    code: string
    message: string
    runId: string
    requestId?: string
    agentId: string
    stage?: string
    diagnostics?: ReturnType<
      typeof import('../chat/errors.js').runErrorDiagnostics
    >
  }) => void
  workflow?: {
    snapshot(): Promise<import('@t-box/shared').AgentWorkflowConfiguration>
  }
  provider: ChatProvider
  registry: CapabilityRegistry
  modulePins?: Record<string, { revision: string, installation: string }>
  host?: AgentHost
  sessions?: SessionRepository
  runTimeoutMs?: number
  clientToolTimeoutMs?: number
  maxToolRounds?: number
}
