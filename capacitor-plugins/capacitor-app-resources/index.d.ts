import type { PluginListenerHandle } from '@capacitor/core'

export interface PackageKey { appId: string, digest: string }
export interface AppResourcesPlugin {
  manifest(options: PackageKey & { baseUrl: string }): Promise<{ content: string }>
  has(options: PackageKey): Promise<{ ready: boolean }>
  prepare(options: PackageKey & { baseUrl: string, filesJson: string }): Promise<void>
  open(options: PackageKey): Promise<{ entryUrl: string }>
  remove(options: PackageKey): Promise<void>
  addListener(name: 'progress', callback: (event: PackageKey & { completed: number, total: number, bytes: number }) => void): Promise<PluginListenerHandle>
}
export declare const AppResources: AppResourcesPlugin
