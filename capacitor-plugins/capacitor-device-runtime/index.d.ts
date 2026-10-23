export interface NativeApplication { appId: string, name: string, guest: boolean }
export interface NativeRequest { id: string, appId: string, params: Record<string, string>, createdAt: number, subject?: string | null }
export interface NativeGrant { scope: string, capabilities: string[] }
export interface NativeShortcutTemplate { id: string, appId: string, actionId: string, actionVersion: number, title: string, releaseId: string, generation: number, subject: string, argumentsJSON: string, bindingsJSON?: string }
export interface DeviceRuntimePlugin {
  addListener(event: 'openRequest', listener: () => void): Promise<{ remove(): Promise<void> }>
  sessionStatus(): Promise<{ subject: string, parent: string }>
  templates(): Promise<{ templates: NativeShortcutTemplate[] }>
  saveTemplate(options: { template: NativeShortcutTemplate }): Promise<void>
  removeTemplate(options: { id: string }): Promise<void>
  environment(): Promise<{ platform: 'ios', capabilities: string[] }>
  permissions(options: { scope: string }): Promise<{ capabilities: string[] }>
  grant(options: NativeGrant): Promise<void>
  revoke(options: NativeGrant): Promise<void>
  invoke(options: { scope: string, capability: string, arguments: Record<string, unknown>, requestId: string }): Promise<unknown>
  configureApplications(options: { applications: NativeApplication[] }): Promise<void>
  pending(): Promise<{ requests: NativeRequest[] }>
  acknowledge(options: { id: string }): Promise<void>
  setSession(options: { token: string, apiBase: string, subject: string }): Promise<void>
  clearSession(): Promise<void>
}
export declare const DeviceRuntime: DeviceRuntimePlugin
