/** Optional application-owned entry points, independent of AI tool exposure. */
export interface ApplicationActionDefinition {
  id: string
  /** Increment when this action's parameter/result contract breaks. */
  version: number
  title: string
  description: string
  inputSchema: Record<string, object | string | number | boolean | null>
  effect: 'read' | 'write'
  background: boolean
}
export interface InstalledApplicationAction extends ApplicationActionDefinition {
  appId: string
  releaseId: string
  generation: number
}
export interface ShortcutTemplateInput {
  title: string
  actionId: string
  actionVersion: number
  arguments: Record<string, unknown>
  /** JSON pointers into existing string fields; evaluated once per shortcut run. */
  runtimeBindings?: Record<string, 'now' | 'today'>
}
