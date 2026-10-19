import type { ApplicationUpdatePrompt, AppPlatform } from './index.js'

/** Additive SDK protocol; executable release protocol remains unchanged. */
export const APP_SDK_VERSION = 1 as const
export interface ApplicationContext {
  sdkVersion: typeof APP_SDK_VERSION
  appId: string
  releaseId: string
  generation: number
  subject: string
  platform: AppPlatform
  runtime: 'shell' | 'web'
  params: Readonly<Record<string, string>>
  /** Host can hide its legacy header after the app claims navigation at ready(). */
  supportsAppNavigation?: boolean
  hostUrl?: string
  updatePrompt?: ApplicationUpdatePrompt
  permissions: readonly string[]
  capabilities: readonly HostMethod[]
  /** A local context identifies a cached installation, not a verified account or backend grant. */
  access?: 'local' | 'online'
}
export interface ApplicationSession {
  status: 'restoring' | 'signed_in' | 'signed_out'
  /** App-scoped identity. Never the host account ID or bearer token. */
  subject: string | null
  profile?: { nickname: string }
}
export type HostMethod =
  | 'updates.getAvailable' | 'updates.openMarket' | 'updates.presentation' | 'updates.respond' |
  'files.pick' | 'files.upload' | 'files.read' |
  'device.reminders' |
  'runtime.context' |
  'auth.session' |
  'api.invoke' |
  'api.request' |
  'resources.bindings' |
  'storage.get' |
  'storage.set' |
  'storage.remove' |
  'navigation.back' |
  'navigation.open' |
  'events.subscribe' |
  'events.unsubscribe'
export interface ApplicationBridgeError {
  code: string
  message: string
  status?: number
}
export interface ApplicationBridgeEvent {
  type: 'event'
  name: 'auth.changed' | 'runtime.closed' | 'runtime.navigation' | 'runtime.interactions.cancelled' | 'app.event' | 'app.event.error' | 'runtime.update'
  data: unknown
}
/** JSON attachments have a separate bounded transport budget; ordinary calls remain small. */
export const APP_HTTP_MAX_BYTES = 15 * 1024 * 1024
export const applicationPayloadLimit = (method: string) => ['api.request', 'files.upload', 'files.read'].includes(method) ? APP_HTTP_MAX_BYTES : 64000
