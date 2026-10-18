import { ErrorCode } from './error-codes.js'
import { validApplicationIcon } from './icons.js'

export interface ApplicationManifest {
  id: string
  name: string
  description: string
  icon: string
  /** Embedded PNG, JPEG, WebP, GIF or static SVG, at most 128 KiB. */
  iconAsset?: string
  /** Declarative live presentation; image uploads always use the image variant. */
  iconVariant?: 'image' | 'calendar' | 'clock'
  color: string
  version: string
  skillIds: readonly string[]
}
export const APP_PROTOCOL = 1 as const
export type AppPlatform = 'web' | 'android' | 'ios'
export type InstallationStatus = 'installing' | 'active' | 'revoked' | 'failed'
export type LifecycleAction = 'install' | 'update' | 'uninstall'
/** Declarative presentation only. Custom UI is registered through the app SDK. */
export interface ApplicationUpdatePrompt {
  mode: 'default' | 'custom'
  title?: string
  description?: string
  confirmText?: string
  deferText?: string
}
export interface ApplicationUpdateInfo {
  appId: string
  name: string
  installedVersion: string
  version: string
  releaseId: string
  releaseNotes: string
  prompt: ApplicationUpdatePrompt
}
export function validateUpdatePrompt(
  value: unknown,
): asserts value is ApplicationUpdatePrompt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ErrorCode.INTERNAL_INVALID_UPDATE_PROMPT()
  }
  const config = value as Record<string, unknown>
  const limits: Record<string, number> = {
    title: 60,
    description: 400,
    confirmText: 24,
    deferText: 24,
  }
  if (
    !['default', 'custom'].includes(String(config.mode)) ||
    Object.keys(config).some(
      (key) => key !== 'mode' && !Object.hasOwn(limits, key),
    )
  ) {
    throw ErrorCode.INTERNAL_INVALID_UPDATE_PROMPT()
  }
  for (const [key, limit] of Object.entries(limits)) {
    if (
      config[key] !== undefined &&
      (typeof config[key] !== 'string' ||
        (config[key] as string).length > limit)
    ) {
      throw ErrorCode.INTERNAL_INVALID_UPDATE_PROMPT_TEXT()
    }
  }
}
export interface AppRelease {
  appId: string
  releaseId: string
  manifest: ApplicationManifest
  protocol: typeof APP_PROTOCOL
  kind: 'system' | 'user'
  platforms: AppPlatform[]
  runtime:
    { type: 'shell' } | { type: 'web', entryUrl: string, integrity: string }
  backend: { type: 'none' | 'local' | 'remote', binding: string }
  permissions: string[]
  clientTools: string[]
  updatePrompt?: ApplicationUpdatePrompt
  defaultInstalled: boolean
}
export interface AppInstallation {
  appId: string
  releaseId: string
  version?: string
  targetReleaseId: string | null
  generation: number
  status: InstallationStatus
  operationId: string | null
  grants: string[]
  error?: string | null
}
export interface MarketEntry {
  release: AppRelease
  installation: AppInstallation | null
  issue?: string | null
  releaseNotes?: string
  /** The running version owns presentation, not the newly published version. */
  installedUpdatePrompt?: ApplicationUpdatePrompt
}
export interface LifecycleRequest {
  operationId: string
  appId: string
  releaseId: string
  subject: string
  generation: number
  action: LifecycleAction
}
export type LifecycleReceipt =
  | { status: 'completed', receipt: Record<string, unknown> } |
  { status: 'pending' } |
  { status: 'rejected', message: string }
export interface BackendInvocation {
  invocationId: string
  appId: string
  releaseId: string
  subject: string
  generation: number
  method: string
  arguments: unknown
  /** Opaque preparation capability. Never expose it to the model or public catalog. */
  preparationTicket?: string
}
export interface RuntimeDescriptor {
  protocol: typeof APP_PROTOCOL
  appId: string
  releaseId: string
  generation: number
  entryUrl: string
  origin: string
  permissions: string[]
  subject: string
  clientTools: string[]
}
export interface BridgeRequest {
  type: 'request'
  id: string
  method: string
  args: unknown
  options?: { idempotencyKey?: string, timeoutMs?: number }
}
export interface BridgeResponse {
  type: 'response'
  id: string
  ok: boolean
  data?: unknown
  error?: string
  failure?: import('./sdk.js').ApplicationBridgeError
}
export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value)
}
export function validateRelease(release: AppRelease): void {
  if (release.updatePrompt !== undefined) {
    validateUpdatePrompt(release.updatePrompt)
  }
  if (
    release.manifest.iconVariant !== undefined &&
    !['image', 'calendar', 'clock'].includes(release.manifest.iconVariant)
  ) {
    throw ErrorCode.INTERNAL_INVALID_APPLICATION_ICON_PRESENTATION()
  }
  if (
    !validId(release.appId) ||
    release.manifest.id !== release.appId ||
    !/^[\w.-]{1,80}$/.test(release.releaseId) ||
    release.protocol !== APP_PROTOCOL ||
    !release.platforms.length ||
    release.platforms.some((p) => !['web', 'android', 'ios'].includes(p)) ||
    new Set(release.permissions).size !== release.permissions.length ||
      new Set(release.clientTools).size !== release.clientTools.length
  ) {
    throw ErrorCode.INTERNAL_INVALID_APPLICATION_RELEASE()
  }
  if (
    release.manifest.iconAsset !== undefined &&
    !validApplicationIcon(release.manifest.iconAsset)
  ) {
    throw ErrorCode.INTERNAL_INVALID_APPLICATION_ICON_IMAGE()
  }
  if (release.runtime.type === 'web') {
    const url = new URL(release.runtime.entryUrl)
    if (
      url.username ||
      url.password ||
      url.hash ||
      !['https:', 'http:'].includes(url.protocol) ||
      (url.protocol !== 'https:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) ||
        !/^sha256-[a-f0-9]{64}$/.test(release.runtime.integrity)
    ) {
      throw ErrorCode.INTERNAL_UNTRUSTED_APPLICATION_ORIGIN()
    }
  }
}

export type PublicationStatus = 'draft' | 'submitted' | 'published' | 'retired'
export interface ManagedRelease {
  release: AppRelease
  status: PublicationStatus
  revision: number
  releaseNotes: string
  createdAt: string
  submittedAt: string | null
  publishedAt: string | null
  readiness: { ready: boolean, reason: string }
}
export interface ManagedApplication {
  appId: string
  kind: AppRelease['kind']
  currentReleaseId: string | null
  releases: ManagedRelease[]
}
export interface ApplicationPublicationEvent {
  id: string
  appId: string
  releaseId: string
  action: string
  administratorId: string
  createdAt: string
}

export * from './backend.js'
export * from './capabilities.js'
export * from './desktop-appearance.js'
export * from './files.js'
export * from './icons.js'
export * from './identifiers.js'
export * from './resources.js'
export * from './sdk.js'
export * from './wallpapers.js'
