import type { Component } from "vue";
import type {
  ApplicationManifest,
  ApplicationClientInteraction,
  ApplicationContractVersion,
  ResourceRef,
} from "@t-box/shared";
export interface ClientApplicationModule {
  /** Build-time trusted declarations, never supplied by model output or a remote manifest. */
  sdk?: {
    restPrefixes?: readonly string[];
    storage?: boolean;
    events?: Record<
      string,
      {
        path: string;
        /** Application owns its wire payload; host owns authentication and reconnection. */
        subscribe(args: unknown): unknown;
      }
    >;
  };
  contractVersion: ApplicationContractVersion;
  manifest: ApplicationManifest;
  /** Host-owned system labels can evolve without rewriting an immutable published release. */
  presentation?: Pick<ApplicationManifest, "name" | "description" | "icon">;
  component: Component;
  prepare?(): Promise<void>;
  navigation: "shell" | "feature";
  host?: Component;
  parseParams(value: unknown): Record<string, string>;
  props(
    params: Readonly<Record<string, string>>,
    context: Readonly<{ openRevision: number }>,
  ): Record<string, unknown>;
  installation: { kind: "system" | "user" };
  /** Optional AI adapter. A desktop-only application does not need tools or resource hooks. */
  ai?: ClientApplicationAIAdapter;
}
export interface ClientApplicationAIAdapter {
  clientTools: Record<string, (args: unknown) => Promise<unknown>>;
  interactions: readonly ApplicationClientInteraction[];
  bindings(): ResourceRef[];
  authorize(resource: ResourceRef, purpose: string): Promise<boolean>;
  cancelInteractions(): void;
}
