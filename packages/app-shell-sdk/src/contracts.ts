import type {
  ApplicationClientInteraction,
  ApplicationContractVersion,
  ApplicationManifest,
  ResourceRef,
} from '@t-box/shared'
import type { Component } from 'vue'

export interface ClientApplicationModule {
  /** Build-time trusted declarations, never supplied by model output or a remote manifest. */
  sdk?: {
    restPrefixes?: readonly string[]
    storage?: boolean
    /** One-way migration from app-owned legacy host keys into app-scoped SDK storage. */
    legacyStorageKeys?: Readonly<Record<string, (userId: string) => string>>
    /** Trusted native adapter; the Web app receives only a status snapshot. */
    reminders?(action: unknown): Promise<unknown>
    events?: Record<
      string,
      {
        path: string
        /** Application owns its wire payload; host owns authentication and reconnection. */
        subscribe(args: unknown): unknown
      }
    >
  }
  contractVersion: ApplicationContractVersion
  manifest: ApplicationManifest
  /** This bundled module can serve installed shell versions from minimumVersion through its own version. */
  shellCompatibility?: { minimumVersion: string }
  /** Host-owned system labels can evolve without rewriting an immutable published release. */
  presentation?: Pick<ApplicationManifest, 'name' | 'description' | 'icon'>
  component: Component
  prepare?(): Promise<void>
  navigation: 'shell' | 'feature'
  host?: Component
  parseParams(value: unknown): Record<string, string>
  /** App-owned public links; the host only validates and routes the returned parameters. */
  resolveLink?(path: string, query: URLSearchParams): Record<string, string> | null
  props(
    params: Readonly<Record<string, string>>,
    context: Readonly<{ openRevision: number }>,
  ): Record<string, unknown>
  installation: { kind: 'system' | 'user' }
  /** Optional AI adapter. A desktop-only application does not need tools or resource hooks. */
  ai?: ClientApplicationAIAdapter
}
export interface ClientApplicationAIAdapter {
  clientTools: Record<string, (args: unknown) => Promise<unknown>>
  interactions: readonly ApplicationClientInteraction[]
  bindings(): ResourceRef[]
  authorize(resource: ResourceRef, purpose: string): Promise<boolean>
  cancelInteractions(): void
}
