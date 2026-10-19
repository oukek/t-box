import type {
  DesktopAppearanceState,
  DesktopIconSize,
  DesktopWallpapers,
  LifecycleAction,
  MarketEntry,
  WallpaperSource,
} from '@t-box/app-contracts'
import type { AppTransport } from '@t-box/app-sdk'
import type { ApplicationManifest, AppUser } from '@t-box/shared'
import type { DeepReadonly } from 'vue'
import { defaultDesktopWallpapers } from '@t-box/app-contracts'
import { createAppClient } from '@t-box/app-sdk'
import { reactive, readonly } from 'vue'
import { ErrorCode } from './error-codes.js'

export * from './contracts'
export { iconSizeOptions } from '@t-box/app-contracts'

/** Privileged first-party shell modules use explicit ports. This is not the untrusted iframe SDK. */
export interface ShellServices {
  createAppTransport(appId: string): AppTransport
  applicationRequest<T>(
    appId: string,
    path: string,
    options?: RequestInit,
  ): Promise<T>
  applicationWrite<T>(
    appId: string,
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
  ): Promise<T>
  request<T>(path: string, options?: RequestInit): Promise<T>
  applicationMutation<T>(
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
  ): Promise<T>
  createRequestId(): string
  openApplication(value: unknown): Promise<unknown>
  backFromApplication(): void
  tabLabel(id: string): string
  openAccountSettings(): void
  openProfile(): Promise<unknown>
  setPreference(key: 'iconSize', value: DesktopIconSize): void
  refreshDesktopAppearance(): Promise<void>
  saveDesktopWallpapers(value: DesktopWallpapers): Promise<void>
  uploadDesktopWallpaper(file: File): Promise<WallpaperSource>
  releaseWallpaperPreviews(): void
  logout(): Promise<void>
  updateNickname(value: string): Promise<void>
  changePassword(currentPassword: string, newPassword: string): Promise<void>
  invalidateSession(): void
  refreshCatalog(): Promise<void>
  changeInstallation(
    entry: DeepReadonly<MarketEntry>,
    action: LifecycleAction,
    key?: string,
  ): Promise<unknown>
  presentApplication(manifest: ApplicationManifest): ApplicationManifest
}
export interface ShellState {
  identity: { user: AppUser | null, ready: boolean, error: string }
  navigation: { backTo: string }
  preferences: { iconSize: DesktopIconSize }
  desktopAppearance: DesktopAppearanceState
  appInfo: { name: string, version: string, description: string }
  appCatalog: {
    entries: MarketEntry[]
    loading: boolean
    error: string
    revision: number
    resources?: Record<string, import('@t-box/app-contracts').DeviceResourceState>
  }
}
const state = reactive<ShellState>({
  identity: { user: null, ready: false, error: '' },
  navigation: { backTo: 'applications' },
  preferences: { iconSize: 'medium' },
  desktopAppearance: {
    revision: 0,
    wallpapers: defaultDesktopWallpapers(),
    loading: false,
    saving: false,
    error: '',
    imageUrls: {},
  },
  appInfo: { name: '', version: '', description: '' },
  appCatalog: { entries: [], loading: false, error: '', revision: 0 },
})
export const identity = readonly(state.identity)
export const navigation = readonly(state.navigation)
export const preferences = readonly(state.preferences)
export const desktopAppearance = readonly(state.desktopAppearance)
export const appInfo = readonly(state.appInfo)
export const appCatalog = readonly(state.appCatalog)
let services: ShellServices | undefined
export function configureShellServices(value: ShellServices) {
  if (services) {
    throw ErrorCode.INTERNAL_SHELL_SERVICES_HAVE_ALREADY_BEEN_CONFIGURED()
  }
  services = value
}
/** Host pushes public state; login tokens never enter the application API. */
export function updateShellState(value: ShellState) {
  for (const key of Object.keys(value) as (keyof ShellState)[]) {
    Object.assign(state[key], value[key])
  }
}
function host() {
  if (!services) {
    throw ErrorCode.INTERNAL_HOST_NOT_INITIALIZED()
  }
  return services
}
export const request = <T>(path: string, options?: RequestInit) =>
  host().request<T>(path, options)
export const applicationMutation = <T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
) => host().applicationMutation<T>(path, method, body)
export const createRequestId = () => host().createRequestId()
export const openApplication = (value: unknown) => host().openApplication(value)
export const backFromApplication = () => host().backFromApplication()
export const tabLabel = (id: string) => host().tabLabel(id)
export const openAccountSettings = () => host().openAccountSettings()
export const openProfile = () => host().openProfile()
export const setPreference = (key: 'iconSize', value: DesktopIconSize) =>
  host().setPreference(key, value)
export const refreshDesktopAppearance = () => host().refreshDesktopAppearance()
export const saveDesktopWallpapers = (value: DesktopWallpapers) =>
  host().saveDesktopWallpapers(value)
export const uploadDesktopWallpaper = (file: File) =>
  host().uploadDesktopWallpaper(file)
export const releaseWallpaperPreviews = () => host().releaseWallpaperPreviews()
export const logout = () => host().logout()
export const updateNickname = (value: string) => host().updateNickname(value)
export const changePassword = (currentPassword: string, newPassword: string) =>
  host().changePassword(currentPassword, newPassword)
export const invalidateSession = () => host().invalidateSession()
export const refreshCatalog = () => host().refreshCatalog()
export const changeInstallation = (
  entry: DeepReadonly<MarketEntry>,
  action: LifecycleAction,
  key?: string,
) => host().changeInstallation(entry, action, key)
export const presentApplication = (manifest: ApplicationManifest) =>
  host().presentApplication(manifest)
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
  }

  /** Remote HTTP boundary; remote codes are data, not locally declared business errors. */
  static fromResponse(
    status: number,
    value?: {
      message?: string
      code?: string
      details?: Record<string, string>
    },
  ) {
    return new RequestError(
      value?.details
        ? Object.values(value.details).join('；')
        : value?.message || `请求失败（${status}）`,
      status,
      value?.code || 'UNKNOWN',
    )
  }
}
/** Transitional REST facade for build-time trusted modules. Never available to iframe applications. */
export function createShellApplication(appId: string) {
  // Modules are imported before the host is configured, so construct the transport lazily.
  let client: ReturnType<typeof createAppClient> | undefined
  return {
    get client() {
      if (!client) {
        const next = createAppClient(host().createAppTransport(appId))
        next.runtime.onClose(() => {
          if (client === next) {
            client = undefined
          }
        })
        client = next
      }
      return client
    },
    request<T>(path: string, options?: RequestInit) {
      return host().applicationRequest<T>(appId, path, options)
    },
    mutation<T>(
      path: string,
      method: 'POST' | 'PATCH' | 'DELETE',
      body: unknown,
    ) {
      return host().applicationWrite<T>(appId, path, method, body)
    },
  }
}
