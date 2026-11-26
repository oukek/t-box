/// <reference types="vite/client" />
declare const __APP_VERSION__: string
declare module 'virtual:tbox-local-applications' {
  const releases: import('@t-box/app-contracts').AppRelease[]
  export const applicationNames: Record<string, string>
  export default releases
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_NATIVE_DEV_SERVER?: string
}

interface Window {
  readonly __TBOX_DESKTOP_KEY__?: string
  Capacitor?: { isNativePlatform(): boolean, getPlatform?(): string }
}

declare const __WEB_BUILD_ID__: string
