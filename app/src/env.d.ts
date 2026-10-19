/// <reference types="vite/client" />
declare const __APP_VERSION__: string
declare module 'virtual:tbox-local-applications' {
  const releases: import('@t-box/app-contracts').AppRelease[]
  export default releases
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
}

interface Window {
  Capacitor?: { isNativePlatform(): boolean, getPlatform?(): string }
}
