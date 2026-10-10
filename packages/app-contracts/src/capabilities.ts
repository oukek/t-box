import type { ApplicationManifest } from './resources.js'

export const APPLICATION_CONTRACT_VERSION = '1.0' as const
export type ApplicationContractVersion = typeof APPLICATION_CONTRACT_VERSION
export type ApplicationToolEffect =
  'read' | 'write' | 'external' | 'ui' | 'configuration'
/** Function schemas are application contracts, independent of a provider's SDK. */
export interface ApplicationToolDefinition {
  type: 'function'
  name: string
  description?: string | null
  parameters: Record<string, unknown>
  strict: boolean | null
}
export interface ApplicationClientInteraction {
  name: string
  title: string
  description: string
  purpose: 'authorization' | 'confirmation' | 'ui'
  inputSchema: Record<string, unknown>
}
export interface ApplicationToolCapability {
  name: string
  title: string
  description: string
  execution: 'server' | 'client'
  effect: ApplicationToolEffect
  inputSchema: Record<string, unknown>
  resourceAuthorization: boolean
  confirmation: boolean
  idempotent: boolean
}
export interface ApplicationCapabilities {
  contractVersion: ApplicationContractVersion
  registryRevision: string
  manifest: ApplicationManifest
  tools: ApplicationToolCapability[]
  skills: {
    id: string
    title: string
    description: string
    version: string
    tools: readonly string[]
  }[]
  agents: {
    id: string
    title: string
    description: string
    version: string
    skillIds: readonly string[]
  }[]
  interactions: readonly ApplicationClientInteraction[]
}
